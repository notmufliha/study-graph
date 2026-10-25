import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { exportAll, importAll, noteToMarkdown, slugify } from "./exportImport";
import { t } from "./tiptap";
import type { Note } from "./types";

const note = (content: object, over: Partial<Note> = {}): Note => ({
  id: "n1",
  title: "Graphs",
  content: JSON.stringify(content),
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe("noteToMarkdown", () => {
  it("converts headings, marks, lists, nested lists and code", () => {
    const nested = {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [t.p("outer"), { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [t.p("inner")] }] }],
        },
      ],
    };
    const doc = t.doc(
      t.h(2, "BFS"),
      t.p("Uses a ", t.b("queue"), " and ", t.code("visit()"), ", see ", {
        type: "text",
        text: "docs",
        marks: [{ type: "link", attrs: { href: "https://x.org" } }],
      }),
      nested,
      t.codeBlock("q.push(s)", "js"),
    );
    expect(noteToMarkdown(note(doc, { tags: ["cs", "algo"] }))).toBe(
      [
        "# Graphs",
        "#cs #algo",
        "## BFS",
        "Uses a **queue** and `visit()`, see [docs](https://x.org)",
        "- outer\n   1. inner",
        "```js\nq.push(s)\n```",
      ].join("\n\n") + "\n",
    );
  });

  it("doesn't repeat the title when the note starts with an H1, and escapes Markdown characters", () => {
    expect(noteToMarkdown(note(t.doc(t.h(1, "Graphs"), t.p("a*b_c"))))).toBe("# Graphs\n\na\\*b\\_c\n");
    expect(noteToMarkdown(note(t.doc(t.h(1, "Graphs"), t.p("x")), { tags: ["cs"] }))).toBe("# Graphs\n\n#cs\n\nx\n");
  });

  it("slugifies file names", () => {
    expect(slugify("Intro to OS: Part 1!")).toBe("intro-to-os-part-1");
    expect(slugify("???")).toBe("note");
  });
});

describe("JSON backup", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((tbl) => tbl.clear()));
  });

  it("round-trips all data and merges concept note lists", async () => {
    await db.notes.add(note(t.doc(t.p("hi"))));
    await db.concepts.add({ id: "c", label: "graph", aliases: [], noteIds: ["n1"], origin: "ai" });
    await db.edges.add({ id: "e", source: "c", target: "c2", relation: "is a", noteId: "n1", origin: "user", status: "accepted" });
    await db.layouts.add({ noteId: "n1", conceptId: "c", x: 1, y: 2, pinned: true });
    await db.rejectedPairs.add({ key: "a|b", createdAt: 1 });
    const backup = JSON.stringify(await exportAll());

    await Promise.all(db.tables.map((tbl) => tbl.clear()));
    await db.concepts.add({ id: "c", label: "graph", aliases: [], noteIds: ["local"], origin: "ai" });

    expect(await importAll(backup)).toEqual({ notes: 1, concepts: 1, edges: 1 });
    expect((await db.concepts.get("c"))!.noteIds.sort()).toEqual(["local", "n1"]);
    expect(await db.layouts.get(["n1", "c"])).toMatchObject({ pinned: true });
    expect(await db.rejectedPairs.count()).toBe(1);
  });

  it("rejects files that aren't backups, without touching data", async () => {
    await db.notes.add(note(t.doc()));
    await expect(importAll("{nope")).rejects.toThrow("isn't valid JSON");
    await expect(importAll(JSON.stringify({ app: "other" }))).rejects.toThrow("isn't a Study Graph backup");
    expect(await db.notes.count()).toBe(1);
  });
});
