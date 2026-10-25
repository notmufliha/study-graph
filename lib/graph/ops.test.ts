import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { useHistory } from "@/store/historyStore";
import { placeNewNodes, relayout } from "./layout";
import * as ops from "./ops";

const N = "note-1";
const undo = () => useHistory.getState().undo(N);
const redo = () => useHistory.getState().redo(N);

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  useHistory.setState({ stacks: {} });
});

describe("graph ops", () => {
  it("adds a user concept, pinned, and undo/redo restore it", async () => {
    const id = (await ops.addConcept(N, "  Mutex ", { x: 10, y: 20 }))!;
    expect(await db.concepts.get(id)).toMatchObject({ label: "mutex", origin: "user", noteIds: [N] });
    expect(await db.layouts.get([N, id])).toMatchObject({ x: 10, y: 20, pinned: true });

    await undo();
    expect(await db.concepts.count()).toBe(0);
    expect(await db.layouts.count()).toBe(0);
    await redo();
    expect(await db.concepts.get(id)).toBeDefined();
  });

  it("reuses an existing concept from another note instead of duplicating", async () => {
    await db.concepts.add({ id: "c1", label: "binary search tree", aliases: ["bst"], noteIds: ["other"] });
    const id = await ops.addConcept(N, "BSTs", { x: 0, y: 0 });
    expect(id).toBe("c1");
    expect((await db.concepts.get("c1"))!.noteIds).toEqual(["other", N]);
  });

  it("deleting a shared concept only removes it from this note and blocks AI re-adding", async () => {
    await db.concepts.bulkAdd([
      { id: "a", label: "process", aliases: [], noteIds: [N, "other"] },
      { id: "b", label: "thread", aliases: [], noteIds: [N] },
    ]);
    await db.edges.bulkAdd([
      { id: "e1", source: "b", target: "a", relation: "part of", noteId: N, origin: "ai", status: "accepted" },
      { id: "e2", source: "b", target: "a", relation: "part of", noteId: "other", origin: "ai", status: "accepted" },
    ]);
    await ops.deleteElements(N, ["a"], []);

    expect((await db.concepts.get("a"))!.noteIds).toEqual(["other"]);
    expect(await db.edges.get("e1")).toBeUndefined();
    expect(await db.edges.get("e2")).toBeDefined(); // the other note's edge is untouched
    expect(await db.deletions.where("noteId").equals(N).toArray()).toMatchObject([{ kind: "concept", key: "process" }]);

    await undo();
    expect((await db.concepts.get("a"))!.noteIds).toEqual([N, "other"]);
    expect(await db.edges.get("e1")).toBeDefined();
    expect(await db.deletions.count()).toBe(0);
  });

  it("renaming keeps the old name as an alias; renaming onto an existing concept merges", async () => {
    await db.concepts.bulkAdd([
      { id: "a", label: "bst", aliases: [], noteIds: [N] },
      { id: "b", label: "binary search tree", aliases: [], noteIds: ["other"] },
      { id: "c", label: "tree", aliases: [], noteIds: [N] },
    ]);
    await db.edges.add({ id: "e", source: "a", target: "c", relation: "is a", noteId: N, origin: "ai", status: "accepted" });

    await ops.renameConcept(N, "c", "Trees");
    expect(await db.concepts.get("c")).toMatchObject({ label: "trees", aliases: [], origin: "user" });

    await ops.renameConcept(N, "a", "Binary Search Tree");
    expect(await db.concepts.get("a")).toBeUndefined();
    expect(await db.concepts.get("b")).toMatchObject({ aliases: ["bst"], noteIds: ["other", N] });
    expect(await db.edges.get("e")).toMatchObject({ source: "b", target: "c" });

    await undo();
    expect(await db.concepts.get("a")).toBeDefined();
    expect(await db.edges.get("e")).toMatchObject({ source: "a" });
  });

  it("doesn't keep the 'new concept' placeholder as an alias", async () => {
    const id = (await ops.addConcept(N, "new concept 2", { x: 0, y: 0 }))!;
    await ops.renameConcept(N, id, "cpu");
    expect(await db.concepts.get(id)).toMatchObject({ label: "cpu", aliases: [] });
  });

  it("deleting an edge blocks it, and rejecting a suggestion remembers the pair", async () => {
    await db.concepts.bulkAdd([
      { id: "a", label: "paging", aliases: [], noteIds: [N] },
      { id: "b", label: "page table", aliases: [], noteIds: [N] },
    ]);
    const id = (await ops.addEdge(N, "b", "a", "used for"))!;
    await ops.deleteElements(N, [], [id]);
    expect((await db.deletions.toArray()).map((d) => d.key)).toEqual(["page table|used for|paging"]);

    await db.edges.add({ id: "s", source: "b", target: "a", relation: "related to", origin: "ai", status: "suggested" });
    await ops.rejectSuggestion(N, "s");
    expect(await db.rejectedPairs.get("a|b")).toBeDefined();

    // Deleting a cross-note edge with the Delete key counts as rejecting it.
    await db.rejectedPairs.clear();
    await db.edges.add({ id: "x", source: "a", target: "b", relation: "related to", origin: "ai", status: "accepted" });
    await ops.deleteElements(N, [], ["x"]);
    expect(await db.rejectedPairs.get("a|b")).toBeDefined();
  });
});

describe("layout", () => {
  const size = { width: 100, height: 40 };
  it("places new nodes without moving existing ones or overlapping them", () => {
    const nodes = [
      { id: "a", ...size, pos: { x: 500, y: 300 }, pinned: true },
      { id: "b", ...size },
      { id: "c", ...size },
    ];
    const pos = placeNewNodes(nodes, [{ source: "a", target: "b" }, { source: "a", target: "c" }]);
    expect([...pos.keys()].sort()).toEqual(["b", "c"]);
    const boxes = [{ x: 500, y: 300 }, pos.get("b")!, pos.get("c")!];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const sep = Math.abs(boxes[i].x - boxes[j].x) >= 100 || Math.abs(boxes[i].y - boxes[j].y) >= 40;
        expect(sep).toBe(true);
      }
  });

  it("re-layout never returns positions for pinned nodes", () => {
    const pos = relayout(
      [
        { id: "a", ...size, pos: { x: 0, y: 0 }, pinned: true },
        { id: "b", ...size, pos: { x: 900, y: 900 }, pinned: false },
      ],
      [{ source: "a", target: "b" }],
    );
    expect(pos.has("a")).toBe(false);
    expect(pos.get("b")!.y).toBeLessThan(900);
  });
});
