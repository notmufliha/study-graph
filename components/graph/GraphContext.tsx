"use client";

import { createContext, useContext } from "react";

export type MenuTarget = { kind: "node" | "edge"; id: string } | { kind: "pane"; flowX: number; flowY: number };

/**
 * Callbacks for custom nodes/edges. Passed through context rather than node
 * `data` so that node data only changes when the concept itself changes.
 */
export type GraphActions = {
  startEdit: (kind: "node" | "edge", id: string) => void;
  cancelEdit: () => void;
  commitLabel: (conceptId: string, value: string) => void;
  commitRelation: (edgeId: string, value: string) => void;
  openMenu: (e: React.MouseEvent, target: MenuTarget) => void;
  selectEdge: (edgeId: string) => void;
  accept: (edgeId: string) => void;
  reject: (edgeId: string) => void;
};

export const GraphContext = createContext<GraphActions | null>(null);

export function useGraph(): GraphActions {
  const ctx = useContext(GraphContext);
  if (!ctx) throw new Error("useGraph must be used inside <GraphContext>");
  return ctx;
}
