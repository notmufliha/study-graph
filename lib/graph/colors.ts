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

const NOTE_PALETTE = ["#6366f1", "#0ea5e9", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#ef4444", "#14b8a6", "#84cc16"];

/** Stable color per note id (global graph "color by note" mode). */
export function noteColor(noteId: string): string {
  let h = 0;
  for (const ch of noteId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return NOTE_PALETTE[h % NOTE_PALETTE.length];
}
