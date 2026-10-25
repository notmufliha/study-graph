import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { t } from "../tiptap";
import { pairKey, planSuggestions, runCrossLinks } from "./crossLinks";
import { runExtraction } from "./liveGraph";
import { OllamaBrowserProvider } from "./ollama";
import { DEFAULT_AI_SETTINGS, chatJSONWithRetry, parseJSON } from "./provider";
import { GraphOpsSchema, jsonSchemaFor } from "./schemas";

const ollamaReply = (content: unknown) =>
  new Response(JSON.stringify({ message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) } }));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await Promise.all(db.tables.map((tbl) => tbl.clear()));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("schemas", () => {
  it("produces a real JSON Schema for structured output", () => {
    const schema = jsonSchemaFor(GraphOpsSchema);
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties as object)).toEqual(["addConcepts", "addEdges", "removeConceptIds"]);
  });

  it("parseJSON accepts fenced JSON and fills defaults", () => {
    expect(parseJSON('```json\n{"addConcepts":[{"label":"x"}]}\n```', GraphOpsSchema)).toEqual({
      addConcepts: [{ label: "x", aliases: [], summary: "", type: "term" }],
      addEdges: [],
      removeConceptIds: [],
    });
  });
});

describe("OllamaBrowserProvider", () => {
  it("sends the schema as format with temperature 0.2, no streaming, thinking off", async () => {
    fetchMock.mockResolvedValue(ollamaReply({ addConcepts: [] }));
    await new OllamaBrowserProvider("http://localhost:11434/", "qwen3:8b").chatJSON([{ role: "user", content: "hi" }], GraphOpsSchema);
    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe("http://localhost:11434/api/chat");
    expect(body).toMatchObject({ model: "qwen3:8b", stream: false, think: false, options: { temperature: 0.2 } });
    expect(body.format.type).toBe("object");
  });

  it("retries without `think` when the model rejects it", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '"llama3.2" does not support thinking' }), { status: 400 }))
      .mockResolvedValueOnce(ollamaReply({}));
    await new OllamaBrowserProvider("http://x", "llama3.2").chatJSON([], GraphOpsSchema);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).think).toBeUndefined();
  });

  it("reports network failures as unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(new OllamaBrowserProvider("http://x", "m").listModels()).rejects.toMatchObject({ name: "UnreachableError" });
  });

  it("retries once on an invalid response, then skips silently", async () => {
    fetchMock.mockImplementation(async () => ollamaReply("not json"));
    const p = new OllamaBrowserProvider("http://x", "m");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await chatJSONWithRetry(p, [], GraphOpsSchema)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("runExtraction", () => {
  it("sends only changed blocks and merges the result", async () => {
    await db.notes.add({ id: "n1", title: "OS", content: "", tags: [], createdAt: 0, updatedAt: 0 });
    await db.concepts.add({ id: "c1", label: "kernel", aliases: [], noteIds: ["n1"], origin: "ai" });
    await db.meta.put({ key: "ai:n1", value: { blocks: ["The kernel is the core."] } });

    fetchMock.mockResolvedValue(
      ollamaReply({
        addConcepts: [{ label: "System Call", type: "process" }],
        addEdges: [{ source: "system call", target: "c1", relation: "requests service from" }],
      }),
    );
    const doc = t.doc(t.h(2, "Basics"), t.p("The kernel is the core."), t.p("Programs use system calls."));
    const res = await runExtraction("n1", doc, DEFAULT_AI_SETTINGS, new AbortController().signal);

    expect(res).toEqual({ kind: "updated", added: 2, removed: 0, pending: false });
    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content as string;
    expect(prompt).toContain("Programs use system calls.");
    expect(prompt).not.toContain("The kernel is the core.\n\"\"\""); // unchanged block isn't resent
    expect(prompt).toContain("c1: kernel");
    expect(await db.concepts.where("label").equals("system call").first()).toMatchObject({ type: "process", noteIds: ["n1"] });
    expect(await db.edges.count()).toBe(1);

    // Nothing changed since: no request.
    fetchMock.mockClear();
    expect(await runExtraction("n1", doc, DEFAULT_AI_SETTINGS, new AbortController().signal)).toEqual({ kind: "nochange" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("discards the answer if the student typed again meanwhile", async () => {
    await db.notes.add({ id: "n1", title: "OS", content: "", tags: [], createdAt: 0, updatedAt: 0 });
    const ctrl = new AbortController();
    fetchMock.mockImplementation(async () => {
      ctrl.abort();
      return ollamaReply({ addConcepts: [{ label: "kernel" }] });
    });
    await expect(runExtraction("n1", t.doc(t.p("kernel")), DEFAULT_AI_SETTINGS, ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(await db.concepts.count()).toBe(0);
  });
});

describe("cross-note suggestions", () => {
  const seed = async () => {
    await db.concepts.bulkAdd([
      { id: "a", label: "process", aliases: [], noteIds: ["n1"], origin: "ai" },
      { id: "b", label: "thread", aliases: [], noteIds: ["n1"], origin: "ai" },
      { id: "x", label: "fork", aliases: [], noteIds: ["n2"], origin: "ai" },
      { id: "y", label: "goroutine", aliases: [], noteIds: ["n2"], origin: "ai" },
    ]);
  };

  it("planSuggestions resolves ids or labels and drops known, rejected and invalid pairs", () => {
    const c = (id: string, label: string) => ({ id, label, aliases: [], noteIds: [] });
    let i = 0;
    const out = planSuggestions({
      links: [
        { source: "a", target: "x", relation: "created_by" },
        { source: "Threads", target: "goroutine", relation: "contrasts with" },
        { source: "a", target: "y", relation: "rejected before" },
        { source: "a", target: "b", relation: "same note" },
        { source: "a", target: "x", relation: "duplicate" },
      ],
      noteConcepts: [c("a", "process"), c("b", "thread")],
      otherConcepts: [c("x", "fork"), c("y", "goroutine")],
      edges: [],
      rejected: new Set([pairKey("y", "a")]),
      newId: () => `s${i++}`,
    });
    expect(out.map((e) => [e.source, e.relation, e.target, e.status, e.noteId])).toEqual([
      ["a", "created by", "x", "suggested", undefined],
      ["b", "contrasts with", "y", "suggested", undefined],
    ]);
  });

  it("runCrossLinks adds suggested edges once, and skips when the note's concepts haven't changed", async () => {
    await seed();
    fetchMock.mockImplementation(async () => ollamaReply({ links: [{ source: "a", target: "x", relation: "created by" }] }));
    expect(await runCrossLinks("n1", DEFAULT_AI_SETTINGS, new AbortController().signal)).toBe(1);
    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content as string;
    expect(prompt).toContain("x: fork");
    expect(prompt.split("OTHER notes")[1]).not.toContain("a: process"); // own concepts aren't "other"

    fetchMock.mockClear();
    expect(await runCrossLinks("n1", DEFAULT_AI_SETTINGS, new AbortController().signal)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
