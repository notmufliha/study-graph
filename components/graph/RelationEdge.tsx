"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import { Icon } from "@/components/ui/Icon";
import { useGraph } from "./GraphContext";
import { InlineInput } from "./InlineInput";

export type RelationEdgeData = {
  relation: string;
  status: "accepted" | "suggested";
  crossNote: boolean;
  editing: boolean;
};
export type RelationFlowEdge = Edge<RelationEdgeData, "relation">;

export const RelationEdge = memo(function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps<RelationFlowEdge>) {
  const g = useGraph();
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const suggested = data?.status === "suggested";
  const emphasis = selected || data?.crossNote;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{
          stroke: emphasis ? "var(--accent)" : "var(--muted)",
          strokeWidth: selected ? 2.2 : 1.4,
          strokeDasharray: suggested ? "6 4" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className={`nodrag nopan pointer-events-auto flex items-center gap-1 rounded-md border bg-surface px-1.5 py-0.5 text-[11px] ${
            selected ? "border-accent text-fg" : "border-border text-muted"
          } ${suggested ? "border-dashed" : ""}`}
          onClick={() => g.selectEdge(id)}
          onDoubleClick={() => g.startEdit("edge", id)}
          onContextMenu={(e) => g.openMenu(e, { kind: "edge", id })}
        >
          {data?.editing ? (
            <InlineInput initial={data.relation} onCommit={(v) => g.commitRelation(id, v)} onCancel={g.cancelEdit} />
          ) : (
            <span className="whitespace-nowrap">{data?.relation}</span>
          )}
          {suggested && !data?.editing && (
            <>
              <button
                title="Accept suggested connection"
                onClick={(e) => (e.stopPropagation(), g.accept(id))}
                className="rounded p-0.5 text-emerald-600 hover:bg-surface-2"
              >
                <Icon name="check" size={12} />
              </button>
              <button
                title="Reject (won't be suggested again)"
                onClick={(e) => (e.stopPropagation(), g.reject(id))}
                className="rounded p-0.5 text-danger hover:bg-surface-2"
              >
                <Icon name="x" size={12} />
              </button>
            </>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
