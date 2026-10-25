"use client";

import { memo } from "react";
import { Handle, Position, useConnection, type Node, type NodeProps } from "@xyflow/react";
import { Icon } from "@/components/ui/Icon";
import { useGraph } from "./GraphContext";
import { InlineInput } from "./InlineInput";

export type ConceptNodeData = {
  label: string;
  summary?: string;
  color: string;
  scale: number; // grows with the number of notes that mention the concept
  mentions: number;
  pinned: boolean;
  highlighted: boolean; // matches the text selected in the editor
  editing: boolean;
};
export type ConceptFlowNode = Node<ConceptNodeData, "concept">;

export const ConceptNode = memo(function ConceptNode({ id, data, selected }: NodeProps<ConceptFlowNode>) {
  const g = useGraph();
  // True while the student drags a new connection from some other node.
  const isDropTarget = useConnection((c) => c.inProgress && c.fromNode.id !== id);
  return (
    <div
      title={data.summary}
      className={`concept-node relative flex items-center gap-1.5 rounded-lg border-2 bg-bg px-3 py-1.5 shadow-sm ${
        selected ? "outline-2 outline-offset-2 outline-accent" : ""
      } ${data.highlighted ? "concept-node-highlight" : ""}`}
      style={{ borderColor: data.color, fontSize: `${13 * data.scale}px` }}
    >
      <Handle type="target" position={Position.Left} />
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: data.color }} />
      {data.editing ? (
        <InlineInput
          initial={data.label}
          onCommit={(v) => g.commitLabel(id, v)}
          onCancel={g.cancelEdit}
          className="font-medium"
        />
      ) : (
        <span className="font-medium whitespace-nowrap">{data.label}</span>
      )}
      {data.pinned && (
        <span title="Pinned: re-layout and AI won't move it" className="text-muted">
          <Icon name="pin" size={11} />
        </span>
      )}
      {data.mentions > 1 && (
        <span
          title={`Mentioned in ${data.mentions} notes`}
          className="rounded-full bg-surface-2 px-1.5 text-[10px] leading-4 text-muted"
        >
          {data.mentions}
        </span>
      )}
      <Handle type="source" position={Position.Right} />
      {/* React Flow only connects when the pointer is released near a handle.
          This invisible node-sized handle, live only during a connection drag,
          lets the student drop anywhere on the node. */}
      <Handle
        id="drop"
        type="target"
        position={Position.Left}
        className="concept-drop-handle"
        style={{ pointerEvents: isDropTarget ? "all" : "none" }}
      />
    </div>
  );
});
