import type { JSONContent } from "@tiptap/core";
import { db } from "../db";
import { newId } from "../id";
import { blocksOf, type Block } from "../tiptap";
import { planMerge, type MergePlan } from "../graph/merge";
import { createProvider } from "./index";
import { extractionMessages } from "./prompts";
import { chatJSONWithRetry, type AISettings } from "./provider";
import { GraphOpsSchema } from "./schemas";

/** Keeps each request small and fast for local models; the rest is picked up next time. */
const MAX_CHARS_PER_REQUEST = 6000;

/** What the model has already seen for each note, so we only send what changed. */
type AIState = { key: string; value: { blocks: string[] } };
const stateKey = (noteId: string) => `ai:${noteId}`;

export async function markProcessed(noteId: string, blocks: string[]) {
  await db.meta.put({ key: stateKey(noteId), value: { blocks } } satisfies AIState);
}

export type ExtractResult = { kind: "nochange" } | { kind: "skipped" } | { kind: "updated"; added: number; removed: number; pending: boolean };

/**
 * One live-update pass for a note: diff the note against what was processed
 * last time, ask the model for incremental ops on just the changed blocks, and
 * merge them in. `full` re-sends the whole note ("Analyze whole note").
 */
export async function runExtraction(
  noteId: string,
  doc: JSONContent,
  settings: AISettings,
  signal: AbortSignal,
  full = false,
): Promise<ExtractResult> {
  const note = await db.notes.get(noteId);
  if (!note) return { kind: "nochange" };

  const blocks = blocksOf(doc);
  const current = blocks.map((b) => b.text);
  const prevRow = await db.meta.get(stateKey(noteId));
  const prev = new Set(full ? [] : ((prevRow?.value as AIState["value"] | undefined)?.blocks ?? []));
  const currentSet = new Set(current);

  // Block-level diff: an edited paragraph shows up as one removed + one added block.
  const changedAll = blocks.filter((b) => !prev.has(b.text));
  const removed = [...prev].filter((t) => !currentSet.has(t));
  if (!changedAll.length && !removed.length) return { kind: "nochange" };

  const changed: Block[] = [];
  let size = 0;
  for (const b of changedAll) {
    if (changed.length && size + b.text.length > MAX_CHARS_PER_REQUEST) break;
    changed.push(b);
    size += b.text.length;
  }
  const pending = changed.length < changedAll.length;

  const existing = (await db.concepts.where("noteIds").equals(noteId).toArray()).map((c) => ({ id: c.id, label: c.label }));
  const messages = extractionMessages({
    title: note.title,
    changed: changed.map((b) => (b.heading && !changed.some((c) => c.text === b.heading) ? `[section: ${b.heading}]\n${b.text}` : b.text)),
    removed: removed.slice(0, 20),
    existing,
  });

  const ops = await chatJSONWithRetry(createProvider(settings), messages, GraphOpsSchema, signal);
  if (!ops) return { kind: "skipped" };
  // The student typed again while we waited: drop this result, a newer run is coming.
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  let plan: MergePlan = { putConcepts: [], putEdges: [], detach: [] };
  let added = 0;
  const noteText = current.join("\n");
  await db.transaction("rw", [db.concepts, db.edges, db.layouts, db.deletions, db.meta], async () => {
    // Plan against the database as it is *now* (the student may have edited the
    // graph during the request), inside the same transaction as the writes.
    const concepts = await db.concepts.toArray();
    const ids = concepts.filter((c) => c.noteIds.includes(noteId)).map((c) => c.id);
    const edges = await db.edges.where("source").anyOf(ids).or("target").anyOf(ids).toArray();
    const layouts = await db.layouts.where("noteId").equals(noteId).toArray();
    const deletions = await db.deletions.where("noteId").equals(noteId).toArray();
    plan = planMerge({
      noteId,
      ops,
      concepts,
      edges,
      pinnedIds: new Set(layouts.filter((l) => l.pinned).map((l) => l.conceptId)),
      deletions,
      noteText,
      newId,
    });
    const before = new Map(concepts.map((c) => [c.id, c]));
    added = plan.putEdges.length + plan.putConcepts.filter((c) => !before.get(c.id)?.noteIds.includes(noteId)).length;
    if (process.env.NODE_ENV !== "production") console.debug("[study-graph ai]", { ops, plan });
    await applyPlan(noteId, plan);

    const processed = new Set(current.filter((t) => prev.has(t)));
    changed.forEach((b) => processed.add(b.text));
    await markProcessed(noteId, [...processed]);
  });

  return { kind: "updated", added, removed: plan.detach.length, pending };
}

async function applyPlan(noteId: string, plan: MergePlan) {
  await db.concepts.bulkPut(plan.putConcepts);
  await db.edges.bulkPut(plan.putEdges);
  for (const id of plan.detach) {
    const c = await db.concepts.get(id);
    if (!c) continue;
    const remaining = c.noteIds.filter((n) => n !== noteId);
    if (remaining.length) {
      await db.concepts.put({ ...c, noteIds: remaining });
      const edges = await db.edges.where("source").equals(id).or("target").equals(id).toArray();
      await db.edges.bulkDelete(edges.filter((e) => e.noteId === noteId && e.origin === "ai").map((e) => e.id));
      await db.layouts.delete([noteId, id]);
    } else {
      await db.concepts.delete(id);
      await db.edges.where("source").equals(id).or("target").equals(id).delete();
      await db.layouts.where("conceptId").equals(id).delete();
    }
  }
}
