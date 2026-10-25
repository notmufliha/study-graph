import type { Concept } from "../types";

export const DEFAULT_RELATION = "related to";

const EDGE_PUNCT = /^[\s"'`“”.,;:!?()[\]{}*_]+|[\s"'`“”.,;:!?()[\]{}*_]+$/g;

/** Display form of a label: lowercase, trimmed, single-spaced, no wrapping punctuation. */
export function normalizeLabel(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/_+/g, " ") // models sometimes answer in snake_case ("used_for")
    .replace(/\s+/g, " ")
    .replace(EDGE_PUNCT, "")
    .trim();
}

// Deliberately naive English singularization, applied to the last word only
// ("binary search trees" -> "binary search tree"). Good enough for dedup; a
// wrong guess just means two concepts don't merge automatically.
function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (/(ss|us|is|ous)$/.test(word)) return word;
  if (/(sh|ch|x|z|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/**
 * Matching key used for deduplication: "Round-Robin Schedulers" and
 * "round robin scheduler" share a key. Never shown to the user.
 */
export function labelKey(s: string): string {
  const words = normalizeLabel(s).replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim().split(" ");
  words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(" ");
}

export function conceptKeys(c: Pick<Concept, "label" | "aliases">): string[] {
  return [c.label, ...c.aliases].map(labelKey);
}

export function findByLabel<T extends Pick<Concept, "label" | "aliases">>(concepts: T[], label: string): T | undefined {
  const key = labelKey(label);
  return concepts.find((c) => conceptKeys(c).includes(key));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Regex matching any term as a whole word, plural "s"/"es" allowed, case-insensitive. */
export function termsRegex(terms: string[]): RegExp | null {
  const clean = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length);
  if (!clean.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${clean.map(escapeRe).join("|")})(?:e?s)?(?![\\p{L}\\p{N}])`, "giu");
}

export function mentionsAny(text: string, terms: string[]): boolean {
  const re = termsRegex(terms);
  return !!re && re.test(text);
}

/** Key for the per-note "deleted by user" blocklist of edges. */
export function edgeKey(sourceLabel: string, relation: string, targetLabel: string): string {
  return `${labelKey(sourceLabel)}|${normalizeLabel(relation)}|${labelKey(targetLabel)}`;
}

/**
 * Which concepts does a text selection in the editor refer to? An exact
 * label/alias match wins; otherwise any concept named inside the selection.
 */
export function matchSelection<T extends Pick<Concept, "id" | "label" | "aliases">>(text: string, concepts: T[]): string[] {
  const norm = normalizeLabel(text);
  if (norm.length < 2 || norm.length > 400) return [];
  const exact = findByLabel(concepts, norm);
  if (exact) return [exact.id];
  const padded = ` ${norm.replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  return concepts
    .filter((c) =>
      [c.label, ...c.aliases].some((l) => {
        const n = normalizeLabel(l).replace(/[^\p{L}\p{N}]+/gu, " ");
        return n.length >= 2 && padded.includes(` ${n} `);
      }),
    )
    .map((c) => c.id);
}
