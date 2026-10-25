import { describe, expect, it } from "vitest";
import type { Concept, Deletion, Edge } from "../types";
import type { z } from "zod";
import { GraphOpsSchema } from "../ai/schemas";
import { planMerge, type MergeInput } from "./merge";

const N = "note-1";
let n = 0;
const base = (over: Omit<Partial<MergeInput>, "ops"> & { ops: z.input<typeof GraphOpsSchema> }): MergeInput => ({
  noteId: N,
  concepts: [],
  edges: [],
  pinnedIds: new Set(),
  deletions: [],
  noteText: "",
  newId: () => `new${++n}`,
  ...over,
  ops: GraphOpsSchema.parse(over.ops),
});
const concept = (id: string, label: string, over: Partial<Concept> = {}): Concept => ({
  id,
  label,
  aliases: [],
  noteIds: [N],
  origin: "ai",
  ...over,
});
const block = (kind: Deletion["kind"], key: string): Deletion => ({ id: key, noteId: N, kind, key, createdAt: 0 });

describe("planMerge: concepts", () => {
  it("adds new concepts with normalized labels", () => {
    const plan = planMerge(base({ ops: { addConcepts: [{ label: "  Page Table ", type: "term", summary: "maps pages" }] } }));
    expect(plan.putConcepts).toMatchObject([{ label: "page table", noteIds: [N], origin: "ai", summary: "maps pages" }]);
  });

  it("dedupes against existing concepts by label, plural and alias", () => {
    const concepts = [concept("c1", "binary search tree", { aliases: ["bst"] })];
    for (const label of ["Binary Search Trees", "BST", "bsts"]) {
      expect(planMerge(base({ concepts, ops: { addConcepts: [{ label }] } })).putConcepts).toEqual([]);
    }
  });

  it("treats a new concept's alias matching an existing label as the same concept", () => {
    const concepts = [concept("c1", "mutex")];
    const plan = planMerge(base({ concepts, ops: { addConcepts: [{ label: "mutual exclusion lock", aliases: ["mutex"] }] } }));
    expect(plan.putConcepts).toHaveLength(1);
    expect(plan.putConcepts[0]).toMatchObject({ id: "c1", aliases: ["mutual exclusion lock"] });
  });

  it("links a concept from another note instead of duplicating it (cross-note connection)", () => {
    const concepts = [concept("c1", "process", { noteIds: ["other"] })];
    const plan = planMerge(base({ concepts, ops: { addConcepts: [{ label: "processes" }] } }));
    expect(plan.putConcepts).toMatchObject([{ id: "c1", noteIds: ["other", N] }]);
  });

  it("never re-adds a concept the student deleted from this note", () => {
    const plan = planMerge(base({ deletions: [block("concept", "kernel")], ops: { addConcepts: [{ label: "Kernels" }] } }));
    expect(plan.putConcepts).toEqual([]);
  });

  it("doesn't change a student-owned concept beyond linking it", () => {
    const concepts = [concept("c1", "thread", { origin: "user", noteIds: ["other"] })];
    const plan = planMerge(base({ concepts, ops: { addConcepts: [{ label: "thread", aliases: ["lightweight process"], summary: "x" }] } }));
    expect(plan.putConcepts).toEqual([{ ...concepts[0], noteIds: ["other", N] }]);
  });

  it("drops junk labels", () => {
    const plan = planMerge(base({ ops: { addConcepts: [{ label: " ** " }, { label: "x".repeat(70) }] } }));
    expect(plan.putConcepts).toEqual([]);
  });
});

describe("planMerge: edges", () => {
  const concepts = [concept("a", "paging"), concept("b", "virtual memory"), concept("o", "elsewhere", { noteIds: ["other"] })];

  it("resolves endpoints by id or label, including concepts added in the same batch", () => {
    const plan = planMerge(
      base({
        concepts,
        ops: {
          addConcepts: [{ label: "page table" }],
          addEdges: [
            { source: "a", target: "Virtual Memory", relation: "Implements" },
            { source: "page tables", target: "a", relation: "used for" },
          ],
        },
      }),
    );
    expect(plan.putEdges.map((e) => [e.source, e.relation, e.target])).toEqual([
      ["a", "implements", "b"],
      [plan.putConcepts[0].id, "used for", "a"],
    ]);
    expect(plan.putEdges[0]).toMatchObject({ noteId: N, origin: "ai", status: "accepted" });
  });

  it("skips unknown endpoints, self-loops, concepts outside this note, and duplicates", () => {
    const plan = planMerge(
      base({
        concepts,
        ops: {
          addEdges: [
            { source: "a", target: "nope", relation: "x" },
            { source: "a", target: "paging", relation: "is" },
            { source: "a", target: "o", relation: "x" },
            { source: "a", target: "b", relation: "first" },
            { source: "b", target: "a", relation: "second" },
          ],
        },
      }),
    );
    expect(plan.putEdges.map((e) => e.relation)).toEqual(["first"]);
  });

  it("never touches a pair the student already connected, or an edge they deleted", () => {
    const userEdge: Edge = { id: "u", source: "a", target: "b", relation: "my words", noteId: N, origin: "user", status: "accepted" };
    expect(planMerge(base({ concepts, edges: [userEdge], ops: { addEdges: [{ source: "a", target: "b", relation: "implements" }] } })).putEdges).toEqual([]);
    const deletions = [block("edge", "paging|implements|virtual memory")];
    expect(planMerge(base({ concepts, deletions, ops: { addEdges: [{ source: "a", target: "b", relation: "implements" }] } })).putEdges).toEqual([]);
  });
});

describe("planMerge: removals", () => {
  const concepts = [
    concept("ai", "segmentation"),
    concept("user", "paging", { origin: "user" }),
    concept("pinned", "tlb"),
    concept("still", "page table"),
    concept("linked", "frame"),
  ];
  const edges: Edge[] = [{ id: "e", source: "linked", target: "ai", relation: "x", noteId: N, origin: "user", status: "accepted" }];

  it("only removes AI concepts that are unpinned, unconnected by the student and no longer mentioned", () => {
    const plan = planMerge(
      base({
        concepts,
        pinnedIds: new Set(["pinned"]),
        noteText: "The page table maps pages.",
        ops: { removeConceptIds: ["ai", "user", "pinned", "still", "linked", "missing"] },
      }),
    );
    expect(plan.detach).toEqual(["ai", "linked"]);
    // Once the student has connected them by hand, both ends are protected.
    expect(planMerge(base({ concepts, edges, ops: { removeConceptIds: ["ai", "linked"] } })).detach).toEqual([]);
  });
});
