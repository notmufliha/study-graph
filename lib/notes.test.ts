import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { createNote, deleteNote, searchNotes } from "./notes";
import { docText, t } from "./tiptap";

beforeEach(async () => {
  await Promise.all(db.tables.map((tbl) => tbl.clear()));
});

describe("tiptap text helpers", () => {
  it("extracts block text with inline marks flattened", () => {
    const doc = t.doc(t.h(1, "Title"), t.p("A ", t.b("bold"), " word"), t.ul("one", "two"));
    expect(docText(JSON.stringify(doc))).toBe("Title\nA bold word\none\ntwo");
  });

  it("survives invalid JSON", () => {
    expect(docText("not json")).toBe("");
  });
});

describe("notes", () => {
  it("searches title, body and concept labels", async () => {
    const a = await createNote({ title: "Graphs", content: JSON.stringify(t.doc(t.p("dijkstra's algorithm"))) });
    const b = await createNote({ title: "Trees" });
    await db.concepts.add({ id: "c1", label: "binary search tree", aliases: ["BST"], noteIds: [b.id] });

    expect((await searchNotes("dijkstra", null)).map((n) => n.id)).toEqual([a.id]);
    expect((await searchNotes("bst", null)).map((n) => n.id)).toEqual([b.id]);
    expect((await searchNotes("graphs", null)).map((n) => n.id)).toEqual([a.id]);
  });

  it("deleting a note keeps concepts that other notes still mention", async () => {
    const a = await createNote();
    const b = await createNote();
    await db.concepts.bulkAdd([
      { id: "shared", label: "process", aliases: [], noteIds: [a.id, b.id] },
      { id: "only-a", label: "thread", aliases: [], noteIds: [a.id] },
    ]);
    await db.edges.add({ id: "e1", source: "shared", target: "only-a", relation: "part of", noteId: a.id, origin: "ai", status: "accepted" });
    await db.layouts.add({ noteId: "global", conceptId: "only-a", x: 0, y: 0, pinned: false });

    await deleteNote(a.id);

    expect(await db.concepts.get("shared")).toMatchObject({ noteIds: [b.id] });
    expect(await db.concepts.get("only-a")).toBeUndefined();
    expect(await db.edges.count()).toBe(0);
    expect(await db.layouts.count()).toBe(0);
  });
});
