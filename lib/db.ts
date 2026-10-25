import Dexie, { type EntityTable, type Table } from "dexie";
import type { Concept, Deletion, Edge, Meta, NodeLayout, Note, RejectedPair } from "./types";

// All data lives in the student's browser (IndexedDB). No server database means
// the Vercel deployment stays free and the app works offline.
export class StudyDB extends Dexie {
  notes!: EntityTable<Note, "id">;
  concepts!: EntityTable<Concept, "id">;
  edges!: EntityTable<Edge, "id">;
  // Compound primary key: one position per (view, concept), so dragging a node
  // in one note's map never moves it in another note or in the global graph.
  layouts!: Table<NodeLayout, [string, string]>;
  deletions!: EntityTable<Deletion, "id">;
  rejectedPairs!: EntityTable<RejectedPair, "key">;
  meta!: EntityTable<Meta, "key">;

  constructor() {
    super("study-graph");
    this.version(1).stores({
      notes: "id, title, updatedAt, *tags",
      // *noteIds is a multi-entry index: "which concepts appear in note X" is one query.
      concepts: "id, label, *aliases, *noteIds",
      edges: "id, source, target, noteId, status",
      layouts: "[noteId+conceptId], noteId, conceptId",
      deletions: "id, noteId, [noteId+kind]",
      rejectedPairs: "key",
      meta: "key",
    });
  }
}

export const db = new StudyDB();
