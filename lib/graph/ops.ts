import { db } from "../db";
import { newId } from "../id";
import type { Concept, ConceptType, Edge, NodeLayout, ViewId } from "../types";
import { recordChanges, type Recorder } from "./history";
import type { XY } from "./layout";
import { DEFAULT_RELATION, edgeKey, findByLabel, labelKey, normalizeLabel } from "./normalize";

export { DEFAULT_RELATION };
import { useHistory } from "@/store/historyStore";

/*
 * Every manual graph edit lives here. They all go through `edit()`, which makes
 * the edit atomic (one IndexedDB transaction) and one undo step. Anything the
 * student touches is marked origin "user" or pinned, which is what tells the AI
 * (phase 3) to leave it alone.
 */

async function edit(view: ViewId, label: string, fn: (rec: Recorder) => Promise<void>) {
  const changes = await recordChanges(fn);
  if (changes.length) useHistory.getState().push(view, { label, changes });
}

const isNote = (view: ViewId) => view !== "global";

/** Removes a "deleted by user" block, because the student just re-added the thing themselves. */
async function unblock(rec: Recorder, noteId: string, kind: "concept" | "edge", key: string) {
  const blocks = await db.deletions.where("[noteId+kind]").equals([noteId, kind]).toArray();
  for (const d of blocks) if (d.key === key) await rec.delete("deletions", d.id);
}

async function block(rec: Recorder, noteId: string, kind: "concept" | "edge", key: string) {
  const blocks = await db.deletions.where("[noteId+kind]").equals([noteId, kind]).toArray();
  if (blocks.some((d) => d.key === key)) return;
  await rec.put("deletions", { id: newId(), noteId, kind, key, createdAt: Date.now() });
}

export async function addConcept(view: ViewId, rawLabel: string, pos: XY): Promise<string | null> {
  const label = normalizeLabel(rawLabel);
  if (!label) return null;
  let id = "";
  await edit(view, "Add concept", async (rec) => {
    // Concepts are shared: typing a name that already exists anywhere reuses that concept.
    const existing = findByLabel(await db.concepts.toArray(), label);
    if (existing) {
      id = existing.id;
      if (isNote(view) && !existing.noteIds.includes(view)) {
        await rec.put("concepts", { ...existing, noteIds: [...existing.noteIds, view] });
      }
    } else {
      id = newId();
      await rec.put("concepts", {
        id,
        label,
        aliases: [],
        noteIds: isNote(view) ? [view] : [],
        origin: "user",
        type: "term",
      });
    }
    if (isNote(view)) await unblock(rec, view, "concept", labelKey(label));
    await rec.put("layouts", { noteId: view, conceptId: id, x: pos.x, y: pos.y, pinned: true });
  });
  return id;
}

/**
 * Renaming to the name of another existing concept merges the two (useful
 * for cleaning up duplicates). Either way the old name is kept as an alias so
 * the AI recognises it and doesn't re-create it.
 */
export async function renameConcept(view: ViewId, id: string, rawLabel: string) {
  const label = normalizeLabel(rawLabel);
  if (!label) return;
  await edit(view, "Rename concept", async (rec) => {
    const c = await db.concepts.get(id);
    if (!c || c.label === label) return;
    const others = (await db.concepts.toArray()).filter((o) => o.id !== id);
    const target = findByLabel(others, label);
    if (target) {
      await mergeInto(rec, c, { ...target, label, origin: "user" });
      return;
    }
    // Keep the old name as an alias, unless it was just the "new concept" placeholder.
    const keepOld = labelKey(c.label) !== labelKey(label) && !PLACEHOLDER.test(c.label);
    const aliases = keepOld ? [...c.aliases, c.label] : c.aliases;
    await rec.put("concepts", { ...c, label, aliases: dedupe(aliases.filter((a) => a !== label)), origin: "user" });
  });
}

export const PLACEHOLDER_LABEL = "new concept";
const PLACEHOLDER = /^new concept( \d+)?$/;

const dedupe = (xs: string[]) => [...new Set(xs)];

async function mergeInto(rec: Recorder, from: Concept, into: Concept) {
  await rec.put("concepts", {
    ...into,
    aliases: dedupe([...into.aliases, ...from.aliases, from.label].filter((a) => a !== into.label)),
    noteIds: dedupe([...into.noteIds, ...from.noteIds]),
  });
  const intoEdges = await db.edges.where("source").equals(into.id).or("target").equals(into.id).toArray();
  const sig = (e: Pick<Edge, "source" | "target" | "relation" | "noteId">) =>
    `${e.source}|${e.target}|${e.relation}|${e.noteId ?? ""}`;
  const seen = new Set(intoEdges.map(sig));
  const fromEdges = await db.edges.where("source").equals(from.id).or("target").equals(from.id).toArray();
  for (const e of fromEdges) {
    const moved = {
      ...e,
      source: e.source === from.id ? into.id : e.source,
      target: e.target === from.id ? into.id : e.target,
    };
    if (moved.source === moved.target || seen.has(sig(moved))) await rec.delete("edges", e.id);
    else {
      seen.add(sig(moved));
      await rec.put("edges", moved);
    }
  }
  for (const l of await db.layouts.where("conceptId").equals(from.id).toArray()) {
    await rec.delete("layouts", [l.noteId, l.conceptId]);
    if (!(await db.layouts.get([l.noteId, into.id]))) await rec.put("layouts", { ...l, conceptId: into.id });
  }
  await rec.delete("concepts", from.id);
}

async function removeConceptEverywhere(rec: Recorder, c: Concept) {
  const edges = await db.edges.where("source").equals(c.id).or("target").equals(c.id).toArray();
  for (const e of edges) await rec.delete("edges", e.id);
  for (const l of await db.layouts.where("conceptId").equals(c.id).toArray()) {
    await rec.delete("layouts", [l.noteId, l.conceptId]);
  }
  await rec.delete("concepts", c.id);
}

async function deleteEdgeRow(rec: Recorder, e: Edge) {
  if (e.noteId) {
    // bulkGet, not Promise.all: a non-Dexie promise inside a transaction can commit it early.
    const [s, t] = await db.concepts.bulkGet([e.source, e.target]);
    if (s && t) await block(rec, e.noteId, "edge", edgeKey(s.label, e.relation, t.label));
  } else {
    // A cross-note edge has no note to block it in; remember the pair instead,
    // exactly like rejecting a suggestion, so the AI never proposes it again.
    await rec.put("rejectedPairs", { key: [e.source, e.target].sort().join("|"), createdAt: Date.now() });
  }
  await rec.delete("edges", e.id);
}

/**
 * Delete key / context menu. In a note's map, deleting a concept only removes
 * it from that note (other notes may still use it) and blocks the AI from
 * re-adding it there. In the global graph it removes the concept entirely.
 */
export async function deleteElements(view: ViewId, conceptIds: string[], edgeIds: string[]) {
  if (!conceptIds.length && !edgeIds.length) return;
  const what = conceptIds.length ? (conceptIds.length > 1 ? "Delete concepts" : "Delete concept") : "Delete edge";
  await edit(view, what, async (rec) => {
    for (const id of edgeIds) {
      const e = await db.edges.get(id);
      if (e) await deleteEdgeRow(rec, e);
    }
    for (const id of conceptIds) {
      const c = await db.concepts.get(id);
      if (!c) continue;
      if (!isNote(view)) {
        for (const n of c.noteIds) await block(rec, n, "concept", labelKey(c.label));
        await removeConceptEverywhere(rec, c);
        continue;
      }
      await block(rec, view, "concept", labelKey(c.label));
      const remaining = c.noteIds.filter((n) => n !== view);
      if (!remaining.length) {
        await removeConceptEverywhere(rec, c);
        continue;
      }
      await rec.put("concepts", { ...c, noteIds: remaining });
      const edges = await db.edges.where("source").equals(id).or("target").equals(id).toArray();
      for (const e of edges) if (e.noteId === view) await rec.delete("edges", e.id);
      await rec.delete("layouts", [view, id]);
    }
  });
}

export async function addEdge(view: ViewId, source: string, target: string, relation = DEFAULT_RELATION) {
  if (source === target) return null;
  let id: string | null = null;
  await edit(view, "Connect concepts", async (rec) => {
    const noteId = isNote(view) ? view : undefined;
    const dup = (await db.edges.where("source").equals(source).toArray()).find(
      (e) => e.target === target && e.noteId === noteId,
    );
    if (dup) {
      id = dup.id;
      return;
    }
    id = newId();
    await rec.put("edges", { id, source, target, relation, noteId, origin: "user", status: "accepted" });
    if (noteId) {
      const [s, t] = await db.concepts.bulkGet([source, target]);
      if (s && t) await unblock(rec, noteId, "edge", edgeKey(s.label, relation, t.label));
    }
  });
  return id;
}

export async function setRelation(view: ViewId, edgeId: string, rawRelation: string) {
  const relation = normalizeLabel(rawRelation) || DEFAULT_RELATION;
  await edit(view, "Edit relation", async (rec) => {
    const e = await db.edges.get(edgeId);
    if (e && e.relation !== relation) await rec.put("edges", { ...e, relation, origin: "user", status: "accepted" });
  });
}

/** Dragging a node pins it, so neither re-layout nor the AI moves it again. */
export async function moveNodes(view: ViewId, moves: { id: string; x: number; y: number }[]) {
  if (!moves.length) return;
  await edit(view, moves.length > 1 ? "Move concepts" : "Move concept", async (rec) => {
    for (const m of moves) {
      await rec.put("layouts", { noteId: view, conceptId: m.id, x: Math.round(m.x), y: Math.round(m.y), pinned: true });
    }
  });
}

export async function setPinned(view: ViewId, ids: string[], pinned: boolean) {
  await edit(view, pinned ? "Pin" : "Unpin", async (rec) => {
    for (const id of ids) {
      const l = await db.layouts.get([view, id]);
      if (l && l.pinned !== pinned) await rec.put("layouts", { ...l, pinned });
    }
  });
}

export async function setConceptType(view: ViewId, id: string, type: ConceptType) {
  await edit(view, "Change type", async (rec) => {
    const c = await db.concepts.get(id);
    if (c && c.type !== type) await rec.put("concepts", { ...c, type, origin: "user" });
  });
}

export async function applyLayout(view: ViewId, positions: Map<string, XY>) {
  await edit(view, "Re-layout", async (rec) => {
    for (const [conceptId, p] of positions) {
      const l = await db.layouts.get([view, conceptId]);
      await rec.put("layouts", { noteId: view, conceptId, x: Math.round(p.x), y: Math.round(p.y), pinned: l?.pinned ?? false });
    }
  });
}

/**
 * Saves automatic positions for newly appeared concepts. Not an undo step:
 * it isn't something the student did, and these nodes stay unpinned.
 */
export async function saveAutoPositions(view: ViewId, positions: Map<string, XY>) {
  const rows: NodeLayout[] = [...positions].map(([conceptId, p]) => ({
    noteId: view,
    conceptId,
    x: Math.round(p.x),
    y: Math.round(p.y),
    pinned: false,
  }));
  await db.transaction("rw", db.layouts, async () => {
    // Only fill gaps; never overwrite a position that appeared meanwhile.
    const existing = await db.layouts.bulkGet(rows.map((r) => [r.noteId, r.conceptId] as [string, string]));
    await db.layouts.bulkPut(rows.filter((_, i) => !existing[i]));
  });
}

export async function acceptSuggestion(view: ViewId, edgeId: string) {
  await edit(view, "Accept suggestion", async (rec) => {
    const e = await db.edges.get(edgeId);
    if (e) await rec.put("edges", { ...e, status: "accepted" });
  });
}

/** Rejected cross-note pairs are remembered forever so they are never suggested again. */
export async function rejectSuggestion(view: ViewId, edgeId: string) {
  await edit(view, "Reject suggestion", async (rec) => {
    const e = await db.edges.get(edgeId);
    if (!e) return;
    await rec.put("rejectedPairs", { key: [e.source, e.target].sort().join("|"), createdAt: Date.now() });
    await rec.delete("edges", e.id);
  });
}
