import type { ConceptType } from "../types";

// Mid-saturation hues that read on both the light and dark node background.
export const TYPE_COLORS: Record<ConceptType, string> = {
  term: "#6366f1",
  process: "#0ea5e9",
  person: "#f59e0b",
  formula: "#10b981",
  other: "#94a3b8",
};

export const TYPE_LABELS: Record<ConceptType, string> = {
  term: "Term",
  process: "Process",
  person: "Person",
  formula: "Formula",
  other: "Other",
};

// Distinct hues, none close to the indigo accent (which marks concepts shared by several notes).
const NOTE_PALETTE = ["#0ea5e9", "#f59e0b", "#10b981", "#ec4899", "#ef4444", "#8b5cf6", "#14b8a6", "#84cc16", "#f97316"];

/**
 * One color per note, assigned in creation order so the first notes get
 * clearly different colors (hashing ids gave near-identical hues).
 */
export function noteColorMap(notes: { id: string; createdAt: number }[]): Map<string, string> {
  const sorted = [...notes].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return new Map(sorted.map((n, i) => [n.id, NOTE_PALETTE[i % NOTE_PALETTE.length]]));
}
