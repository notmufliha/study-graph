import { create } from "zustand";
import { applyEntry, type HistoryEntry } from "@/lib/graph/history";
import type { ViewId } from "@/lib/types";

const LIMIT = 100;

type Stack = { undo: HistoryEntry[]; redo: HistoryEntry[] };

type HistoryState = {
  // One stack per view (each note's map, plus "global"), so Ctrl+Z in one
  // map never undoes something the student did in another.
  stacks: Record<ViewId, Stack>;
  push: (view: ViewId, entry: HistoryEntry) => void;
  undo: (view: ViewId) => Promise<void>;
  redo: (view: ViewId) => Promise<void>;
};

const empty: Stack = { undo: [], redo: [] };

export const useHistory = create<HistoryState>()((set, get) => ({
  stacks: {},
  push: (view, entry) =>
    set((s) => {
      const st = s.stacks[view] ?? empty;
      return { stacks: { ...s.stacks, [view]: { undo: [...st.undo, entry].slice(-LIMIT), redo: [] } } };
    }),
  undo: async (view) => {
    const st = get().stacks[view] ?? empty;
    const entry = st.undo.at(-1);
    if (!entry) return;
    set((s) => ({ stacks: { ...s.stacks, [view]: { undo: st.undo.slice(0, -1), redo: [...st.redo, entry] } } }));
    await applyEntry(entry, "undo");
  },
  redo: async (view) => {
    const st = get().stacks[view] ?? empty;
    const entry = st.redo.at(-1);
    if (!entry) return;
    set((s) => ({ stacks: { ...s.stacks, [view]: { undo: [...st.undo, entry], redo: st.redo.slice(0, -1) } } }));
    await applyEntry(entry, "redo");
  },
}));
