import { db } from "../db";
import { newId } from "../id";
import { normalizeLabel, DEFAULT_RELATION, findByLabel } from "../graph/normalize";
import type { Concept, Edge } from "../types";
import { createProvider } from "./index";
import { crossLinkMessages } from "./prompts";
import { chatJSONWithRetry, type AISettings } from "./provider";
import { CrossLinksSchema, type CrossLinks } from "./schemas";

const MAX_NOTE_CONCEPTS = 40;
const MAX_OTHER_CONCEPTS = 150;

export const pairKey = (a: string, b: string) => [a, b].sort().join("|");
const stateKey = (noteId: string) => `cross:${noteId}`;

/**
 * Turns the model's proposed links into suggested cross-note edges. Endpoints
 * may come back as ids or labels; anything unknown, already connected, or
 * previously rejected by the student is dropped.
 */
export function planSuggestions(input: {
  links: CrossLinks["links"];
  noteConcepts: Concept[];
  otherConcepts: Concept[];
  edges: Edge[];
  rejected: Set<string>;
  newId: () => string;
}): Edge[] {
  const resolve = (ref: string, pool: Concept[]) => pool.find((c) => c.id === ref) ?? findByLabel(pool, ref);
  const connected = new Set(input.edges.map((e) => pairKey(e.source, e.target)));
  const out: Edge[] = [];
  for (const link of input.links) {
    const s = resolve(link.source, input.noteConcepts);
    const t = resolve(link.target, input.otherConcepts);
    if (!s || !t || s.id === t.id) continue;
    const key = pairKey(s.id, t.id);
    if (connected.has(key) || input.rejected.has(key)) continue;
    connected.add(key);
    out.push({
      id: input.newId(),
      source: s.id,
      target: t.id,
      relation: normalizeLabel(link.relation) || DEFAULT_RELATION,
      // No noteId: this edge belongs to no single note; that's what makes it cross-note.
      origin: "ai",
      status: "suggested",
    });
  }
  return out;
}

/**
 * The second, cheaper pass: only concept labels go to the model, never note
 * text. Skipped when the note's concept set hasn't changed since last time.
 */
export async function runCrossLinks(noteId: string, settings: AISettings, signal: AbortSignal): Promise<number> {
  const all = await db.concepts.toArray();
  const mine = all.filter((c) => c.noteIds.includes(noteId));
  const others = all
    .filter((c) => !c.noteIds.includes(noteId) && c.noteIds.length > 0)
    .sort((a, b) => b.noteIds.length - a.noteIds.length)
    .slice(0, MAX_OTHER_CONCEPTS);
  if (!mine.length || !others.length) return 0;

  const signature = mine.map((c) => c.id).sort().join(",");
  if ((await db.meta.get(stateKey(noteId)))?.value === signature) return 0;

  const noteConcepts = mine.slice(0, MAX_NOTE_CONCEPTS);
  const res = await chatJSONWithRetry(
    createProvider(settings),
    crossLinkMessages({
      noteConcepts: noteConcepts.map((c) => ({ id: c.id, label: c.label })),
      otherConcepts: others.map((c) => ({ id: c.id, label: c.label })),
    }),
    CrossLinksSchema,
    signal,
  );
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (!res) return 0;

  let added = 0;
  await db.transaction("rw", [db.concepts, db.edges, db.rejectedPairs, db.meta], async () => {
    const ids = noteConcepts.map((c) => c.id);
    const edges = await db.edges.where("source").anyOf(ids).or("target").anyOf(ids).toArray();
    const rejected = new Set((await db.rejectedPairs.toArray()).map((r) => r.key));
    // Re-read concepts: the student may have deleted some while we waited.
    const live = new Map((await db.concepts.bulkGet([...ids, ...others.map((c) => c.id)])).filter((c) => !!c).map((c) => [c!.id, c!]));
    const suggestions = planSuggestions({
      links: res.links,
      noteConcepts: noteConcepts.filter((c) => live.has(c.id)),
      otherConcepts: others.filter((c) => live.has(c.id)),
      edges,
      rejected,
      newId,
    });
    await db.edges.bulkAdd(suggestions);
    await db.meta.put({ key: stateKey(noteId), value: signature });
    added = suggestions.length;
  });
  return added;
}
