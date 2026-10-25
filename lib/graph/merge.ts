import type { GraphOps } from "../ai/schemas";
import type { Concept, Deletion, Edge } from "../types";
import { DEFAULT_RELATION, conceptKeys, edgeKey, findByLabel, labelKey, mentionsAny, normalizeLabel } from "./normalize";

export type MergeInput = {
  noteId: string;
  ops: GraphOps;
  /** Every concept in the database: concepts are shared, so dedup is global. */
  concepts: Concept[];
  /** Every edge touching this note's concepts. */
  edges: Edge[];
  /** Concepts pinned in this note's map. */
  pinnedIds: Set<string>;
  /** This note's "deleted by user" blocklist. */
  deletions: Deletion[];
  /** Current plain text of the note, to double-check removals. */
  noteText: string;
  newId: () => string;
};

export type MergePlan = {
  putConcepts: Concept[];
  putEdges: Edge[];
  /** Concepts to drop from this note (deleted entirely if no other note uses them). */
  detach: string[];
};

const MAX_LABEL = 60;

/**
 * Turns the model's incremental operations into concrete writes, enforcing the
 * rules that keep the AI from fighting the student:
 * - concepts dedupe globally by normalized label + aliases (that's what links notes);
 * - anything the student deleted from this note is never re-added;
 * - concepts/edges with origin "user" are never modified or removed;
 * - removals only apply to AI concepts that are no longer mentioned in the text
 *   and that the student hasn't pinned.
 */
export function planMerge(input: MergeInput): MergePlan {
  const { noteId, ops } = input;
  const blockedConcepts = new Set(input.deletions.filter((d) => d.kind === "concept").map((d) => d.key));
  const blockedEdges = new Set(input.deletions.filter((d) => d.kind === "edge").map((d) => d.key));

  // Working copy so later ops in the same batch see earlier ones.
  const byId = new Map(input.concepts.map((c) => [c.id, c]));
  const touched = new Map<string, Concept>();
  const put = (c: Concept) => {
    byId.set(c.id, c);
    touched.set(c.id, c);
  };
  const all = () => [...byId.values()];
  const inNote = (c: Concept) => c.noteIds.includes(noteId);

  for (const raw of ops.addConcepts) {
    const label = normalizeLabel(raw.label);
    if (!label || label.length > MAX_LABEL) continue;
    const aliases = [...new Set(raw.aliases.map(normalizeLabel).filter((a) => a && a !== label && a.length <= MAX_LABEL))];
    const keys = [label, ...aliases].map(labelKey);
    if (keys.some((k) => blockedConcepts.has(k))) continue;

    const existing = findByLabel(all(), label) ?? aliases.map((a) => findByLabel(all(), a)).find(Boolean);
    if (existing) {
      // Link the shared concept to this note. A student-owned concept is otherwise left exactly as is.
      const next: Concept = { ...existing, noteIds: inNote(existing) ? existing.noteIds : [...existing.noteIds, noteId] };
      if (existing.origin !== "user") {
        const known = new Set(conceptKeys(existing));
        next.aliases = [...existing.aliases, ...[label, ...aliases].filter((a) => !known.has(labelKey(a)))];
        if (!existing.summary && raw.summary) next.summary = raw.summary.trim();
      }
      if (JSON.stringify(next) !== JSON.stringify(existing)) put(next);
      continue;
    }
    put({
      id: input.newId(),
      label,
      aliases,
      summary: raw.summary.trim() || undefined,
      noteIds: [noteId],
      origin: "ai",
      type: raw.type,
    });
  }

  // Edge endpoints may be ids or labels; only concepts in this note qualify.
  const resolve = (ref: string): Concept | undefined => {
    const byRef = byId.get(ref);
    if (byRef && inNote(byRef)) return byRef;
    const found = findByLabel(all().filter(inNote), ref);
    return found;
  };
  const pairs = new Set(
    input.edges
      .filter((e) => e.noteId === noteId || !e.noteId)
      .flatMap((e) => [`${e.source}|${e.target}`, `${e.target}|${e.source}`]),
  );
  const putEdges: Edge[] = [];
  for (const raw of ops.addEdges) {
    const s = resolve(raw.source);
    const t = resolve(raw.target);
    if (!s || !t || s.id === t.id) continue;
    // One edge per pair: never duplicate, and never touch an edge the student made or edited.
    if (pairs.has(`${s.id}|${t.id}`)) continue;
    const relation = normalizeLabel(raw.relation) || DEFAULT_RELATION;
    if (blockedEdges.has(edgeKey(s.label, relation, t.label))) continue;
    pairs.add(`${s.id}|${t.id}`).add(`${t.id}|${s.id}`);
    putEdges.push({ id: input.newId(), source: s.id, target: t.id, relation, noteId, origin: "ai", status: "accepted" });
  }

  const detach = [...new Set(ops.removeConceptIds)].filter((id) => {
    const c = byId.get(id);
    if (!c || !inNote(c) || c.origin === "user" || input.pinnedIds.has(id) || touched.has(id)) return false;
    // A concept the student connected by hand counts as theirs too.
    if (input.edges.some((e) => e.origin === "user" && (e.source === id || e.target === id))) return false;
    // The model only saw part of the note; keep anything still mentioned elsewhere in it.
    return !mentionsAny(input.noteText, [c.label, ...c.aliases]);
  });

  return { putConcepts: [...touched.values()], putEdges, detach };
}
