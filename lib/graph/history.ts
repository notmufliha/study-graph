import Dexie, { type IndexableType, type Table } from "dexie";
import { db } from "../db";
import type { Concept, Deletion, Edge, NodeLayout, RejectedPair } from "../types";

type Rows = {
  concepts: Concept;
  edges: Edge;
  layouts: NodeLayout;
  deletions: Deletion;
  rejectedPairs: RejectedPair;
};
export type GraphTable = keyof Rows;

export type Change = { table: GraphTable; key: IndexableType; before?: unknown; after?: unknown };
export type HistoryEntry = { label: string; changes: Change[] };

const GRAPH_TABLES: GraphTable[] = ["concepts", "edges", "layouts", "deletions", "rejectedPairs"];

const table = (name: GraphTable) => db.table<unknown, IndexableType>(name);

function keyOf<K extends GraphTable>(name: K, row: Rows[K]): IndexableType {
  switch (name) {
    case "layouts": {
      const l = row as NodeLayout;
      return [l.noteId, l.conceptId];
    }
    case "rejectedPairs":
      return (row as RejectedPair).key;
    default:
      return (row as { id: string }).id;
  }
}

/**
 * Undo/redo works by snapshots instead of hand-written inverse operations:
 * every write in a graph edit goes through a Recorder, which remembers each
 * row's value before the edit and after it. Undo writes the "before" values
 * back; redo writes the "after" values. This stays correct no matter how many
 * rows an edit touches (e.g. deleting a concept also deletes its edges).
 */
export class Recorder {
  private changes = new Map<string, Change>();

  // Plain Dexie promise chains rather than async functions: Dexie keeps a
  // transaction alive across only so many layers of native `await`, and every
  // extra async wrapper here would count against that in each op.
  private track(name: GraphTable, key: IndexableType, after: unknown) {
    const id = `${name}:${JSON.stringify(key)}`;
    const existing = this.changes.get(id);
    if (existing) {
      existing.after = after;
      return Dexie.Promise.resolve();
    }
    return table(name)
      .get(key)
      .then((before) => {
        this.changes.set(id, { table: name, key, before, after });
      });
  }

  put<K extends GraphTable>(name: K, row: Rows[K]) {
    return this.track(name, keyOf(name, row), row).then(() => table(name).put(row));
  }

  delete(name: GraphTable, key: IndexableType) {
    return this.track(name, key, undefined).then(() => table(name).delete(key));
  }

  /** Changes that actually changed something. */
  result(): Change[] {
    return [...this.changes.values()].filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
  }
}

/** Runs `fn` in one IndexedDB transaction and returns what it changed. */
export async function recordChanges(fn: (rec: Recorder) => Promise<void>): Promise<Change[]> {
  const rec = new Recorder();
  await db.transaction("rw", GRAPH_TABLES.map(table) as Table[], () => fn(rec));
  return rec.result();
}

export async function applyEntry(entry: HistoryEntry, direction: "undo" | "redo") {
  const changes = direction === "undo" ? [...entry.changes].reverse() : entry.changes;
  await db.transaction("rw", GRAPH_TABLES.map(table) as Table[], async () => {
    for (const c of changes) {
      const value = direction === "undo" ? c.before : c.after;
      if (value === undefined) await table(c.table).delete(c.key);
      else await table(c.table).put(value);
    }
  });
}
