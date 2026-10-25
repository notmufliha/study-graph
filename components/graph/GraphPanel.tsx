"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Editor } from "@tiptap/react";
import { db } from "@/lib/db";
import type { Concept, ConceptType, Edge, NodeLayout, ViewId } from "@/lib/types";
import { TYPE_COLORS, TYPE_LABELS, noteColor } from "@/lib/graph/colors";
import { estimateNodeSize, placeNewNodes, relayout, type LayoutNode, type XY } from "@/lib/graph/layout";
import { matchSelection } from "@/lib/graph/normalize";
import * as ops from "@/lib/graph/ops";
import { useHistory } from "@/store/historyStore";
import { useUI } from "@/store/uiStore";
import { Icon, type IconName } from "@/components/ui/Icon";
import { jumpToTerms, setHighlightTerms } from "@/components/editor/conceptHighlight";
import { ConceptNode, type ConceptFlowNode } from "./ConceptNode";
import { RelationEdge, type RelationFlowEdge } from "./RelationEdge";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { GraphContext, type GraphActions, type MenuTarget } from "./GraphContext";

const nodeTypes = { concept: ConceptNode };
const edgeTypes = { relation: RelationEdge };

type GraphData = { concepts: Concept[]; edges: Edge[]; layouts: NodeLayout[] };

type Props = {
  /** A note id (that note's mind map) or "global" (every concept). */
  view: ViewId;
  /** The note editor, for node <-> text highlighting. Absent in the global view. */
  editor?: Editor | null;
  /** Text currently selected in the editor. */
  editorSelection?: string;
  colorBy?: "type" | "note";
};

export function GraphPanel(props: Props) {
  const data = useLiveQuery(() => loadGraph(props.view), [props.view]);
  if (!data) return <div className="p-4 text-sm text-muted">Loading map…</div>;
  return (
    <ReactFlowProvider>
      <GraphFlow {...props} data={data} />
    </ReactFlowProvider>
  );
}

async function loadGraph(view: ViewId): Promise<GraphData> {
  const concepts =
    view === "global" ? await db.concepts.toArray() : await db.concepts.where("noteIds").equals(view).toArray();
  const ids = new Set(concepts.map((c) => c.id));
  const edges = (view === "global" ? await db.edges.toArray() : await db.edges.where("source").anyOf([...ids]).toArray())
    // A note's map shows its own edges plus cross-note edges between its concepts.
    .filter((e) => ids.has(e.source) && ids.has(e.target) && (view === "global" || !e.noteId || e.noteId === view));
  const layouts = await db.layouts.where("noteId").equals(view).toArray();
  return { concepts, edges, layouts };
}

const scaleFor = (c: Concept) => Math.min(1.6, 1 + 0.15 * Math.max(0, c.noteIds.length - 1));
const termsOf = (c: Concept | undefined) => (c ? [c.label, ...c.aliases] : []);

type Editing = { kind: "node" | "edge"; id: string } | null;
type MenuState = { x: number; y: number; target: MenuTarget };

function GraphFlow({ view, editor, editorSelection = "", colorBy = "type", data }: Props & { data: GraphData }) {
  const rf = useReactFlow<ConceptFlowNode, RelationFlowEdge>();
  const theme = useUI((s) => s.theme);
  const canUndo = useHistory((s) => (s.stacks[view]?.undo.length ?? 0) > 0);
  const canRedo = useHistory((s) => (s.stacks[view]?.redo.length ?? 0) > 0);
  const wrapper = useRef<HTMLDivElement>(null);

  const [editing, setEditing] = useState<Editing>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const conceptById = useMemo(() => new Map(data.concepts.map((c) => [c.id, c])), [data.concepts]);
  const layoutById = useMemo(() => new Map(data.layouts.map((l) => [l.conceptId, l])), [data.layouts]);

  const layoutInput = useCallback(
    (overrides?: Map<string, XY>): LayoutNode[] =>
      data.concepts.map((c) => {
        const l = layoutById.get(c.id);
        const pos = l ? { x: l.x, y: l.y } : overrides?.get(c.id);
        return { id: c.id, ...estimateNodeSize(c.label, scaleFor(c)), pos, pinned: l?.pinned };
      }),
    [data.concepts, layoutById],
  );

  // Concepts without a saved position (seeded or newly added) are placed with
  // dagre next to their neighbours, shown immediately, and saved in the background.
  const autoPositions = useMemo(() => placeNewNodes(layoutInput(), data.edges), [layoutInput, data.edges]);
  useEffect(() => {
    if (autoPositions.size) void ops.saveAutoPositions(view, autoPositions);
  }, [autoPositions, view]);

  const highlighted = useMemo(() => new Set(matchSelection(editorSelection, data.concepts)), [editorSelection, data.concepts]);

  const baseNodes = useMemo<ConceptFlowNode[]>(
    () =>
      data.concepts.map((c) => {
        const l = layoutById.get(c.id);
        const color =
          colorBy === "note"
            ? c.noteIds.length > 1
              ? "var(--accent)"
              : noteColor(c.noteIds[0] ?? "none")
            : TYPE_COLORS[c.type ?? "term"];
        return {
          id: c.id,
          type: "concept",
          position: l ? { x: l.x, y: l.y } : (autoPositions.get(c.id) ?? { x: 0, y: 0 }),
          data: {
            label: c.label,
            summary: c.summary,
            color,
            scale: scaleFor(c),
            mentions: c.noteIds.length,
            pinned: !!l?.pinned,
            highlighted: highlighted.has(c.id),
            editing: editing?.kind === "node" && editing.id === c.id,
          },
        };
      }),
    [data.concepts, layoutById, autoPositions, colorBy, highlighted, editing],
  );

  const baseEdges = useMemo<RelationFlowEdge[]>(
    () =>
      data.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "relation",
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: e.noteId ? "var(--muted)" : "var(--accent)" },
        data: {
          relation: e.relation,
          status: e.status,
          crossNote: !e.noteId,
          editing: editing?.kind === "edge" && editing.id === e.id,
        },
      })),
    [data.edges, editing],
  );

  // React Flow needs local state for smooth dragging, but IndexedDB is the
  // source of truth. When the DB data changes we rebuild the local nodes during
  // render (React's "adjust state on prop change" pattern), keeping selection,
  // measured sizes and the position of anything mid-drag.
  const [nodes, setNodes] = useState(baseNodes);
  const [edges, setEdges] = useState(baseEdges);
  const [prevBase, setPrevBase] = useState({ baseNodes, baseEdges });
  if (prevBase.baseNodes !== baseNodes || prevBase.baseEdges !== baseEdges) {
    setPrevBase({ baseNodes, baseEdges });
    setNodes((cur) => {
      const old = new Map(cur.map((n) => [n.id, n]));
      return baseNodes.map((n) => {
        const o = old.get(n.id);
        if (!o) return n;
        return { ...n, selected: o.selected, measured: o.measured, ...(o.dragging ? { position: o.position, dragging: true } : {}) };
      });
    });
    setEdges((cur) => {
      const selected = new Set(cur.filter((e) => e.selected).map((e) => e.id));
      return baseEdges.map((e) => (selected.has(e.id) ? { ...e, selected: true } : e));
    });
  }

  // Deletions go through onDelete -> IndexedDB (one undo step), so local
  // "remove" changes are ignored here; the live query removes them for real.
  const onNodesChange = useCallback(
    (changes: NodeChange<ConceptFlowNode>[]) =>
      setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type !== "remove"), ns)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<RelationFlowEdge>[]) =>
      setEdges((es) => applyEdgeChanges(changes.filter((c) => c.type !== "remove"), es)),
    [],
  );

  const saveMoves = useCallback(
    (moved: ConceptFlowNode[]) => {
      const changed = moved.filter((n) => {
        const l = layoutById.get(n.id);
        return !l || Math.round(l.x) !== Math.round(n.position.x) || Math.round(l.y) !== Math.round(n.position.y);
      });
      void ops.moveNodes(view, changed.map((n) => ({ id: n.id, ...n.position })));
    },
    [layoutById, view],
  );

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2500);
  }, []);

  const uniqueLabel = useCallback(() => {
    const taken = new Set(data.concepts.map((c) => c.label));
    let label = "new concept";
    for (let i = 2; taken.has(label); i++) label = `new concept ${i}`;
    return label;
  }, [data.concepts]);

  const addAt = useCallback(
    async (pos: XY) => {
      const id = await ops.addConcept(view, uniqueLabel(), pos);
      if (id) setEditing({ kind: "node", id });
    },
    [view, uniqueLabel],
  );

  const addAtCenter = () => {
    const r = wrapper.current?.getBoundingClientRect();
    if (!r) return;
    const p = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    void addAt({ x: p.x - 50, y: p.y - 20 });
  };

  const doRelayout = async () => {
    await ops.applyLayout(view, relayout(layoutInput(autoPositions), data.edges));
    setTimeout(() => void rf.fitView({ duration: 300, padding: 0.15 }), 60);
  };

  const undo = () => void useHistory.getState().undo(view);
  const redo = () => void useHistory.getState().redo(view);

  const actions = useMemo<GraphActions>(
    () => ({
      startEdit: (kind, id) => setEditing({ kind, id }),
      cancelEdit: () => setEditing(null),
      commitLabel: (id, value) => {
        setEditing(null);
        void ops.renameConcept(view, id, value);
      },
      commitRelation: (id, value) => {
        setEditing(null);
        void ops.setRelation(view, id, value);
      },
      openMenu: (e, target) => {
        e.preventDefault();
        const r = wrapper.current!.getBoundingClientRect();
        setMenu({
          x: Math.min(e.clientX - r.left, r.width - 210),
          y: Math.min(e.clientY - r.top, r.height - 260),
          target,
        });
      },
      selectEdge: (id) => {
        setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        setEdges((es) => es.map((e) => ({ ...e, selected: e.id === id })));
      },
      accept: (id) => void ops.acceptSuggestion(view, id),
      reject: (id) => void ops.rejectSuggestion(view, id),
    }),
    [view],
  );

  const menuItems = (): MenuItem[] => {
    if (!menu) return [];
    const t = menu.target;
    if (t.kind === "pane") {
      return [
        { kind: "item", label: "Add concept here", icon: "plus", onSelect: () => void addAt({ x: t.flowX, y: t.flowY }) },
        { kind: "item", label: "Re-layout", icon: "layout", onSelect: () => void doRelayout() },
        { kind: "item", label: "Fit view", icon: "crosshair", onSelect: () => void rf.fitView({ duration: 300 }) },
      ];
    }
    if (t.kind === "edge") {
      const e = data.edges.find((x) => x.id === t.id);
      return [
        { kind: "item", label: "Edit relation", icon: "pencil", onSelect: () => setEditing({ kind: "edge", id: t.id }) },
        ...(e?.status === "suggested"
          ? ([
              { kind: "item", label: "Accept suggestion", icon: "check", onSelect: () => actions.accept(t.id) },
              { kind: "item", label: "Reject suggestion", icon: "x", onSelect: () => actions.reject(t.id) },
            ] as MenuItem[])
          : []),
        { kind: "separator" },
        { kind: "item", label: "Delete", icon: "trash", danger: true, onSelect: () => void ops.deleteElements(view, [], [t.id]) },
      ];
    }
    const c = conceptById.get(t.id);
    const pinned = !!layoutById.get(t.id)?.pinned;
    return [
      { kind: "item", label: "Rename", icon: "pencil", onSelect: () => setEditing({ kind: "node", id: t.id }) },
      { kind: "item", label: pinned ? "Unpin" : "Pin in place", icon: "pin", onSelect: () => void ops.setPinned(view, [t.id], !pinned) },
      ...(editor
        ? ([
            {
              kind: "item",
              label: "Jump to mention in note",
              icon: "locate",
              onSelect: () => !jumpToTerms(editor, termsOf(c)) && flash(`"${c?.label}" isn't mentioned in the text`),
            },
          ] as MenuItem[])
        : []),
      { kind: "item", label: "Ask AI to explain", icon: "sparkles", disabled: true, hint: "Phase 3", onSelect: () => {} },
      { kind: "separator" },
      {
        kind: "custom",
        render: () => (
          <div className="flex items-center gap-1 px-2 py-1">
            <span className="mr-1 text-xs text-muted">Type</span>
            {(Object.keys(TYPE_COLORS) as ConceptType[]).map((ty) => (
              <button
                key={ty}
                title={TYPE_LABELS[ty]}
                onClick={() => {
                  setMenu(null);
                  void ops.setConceptType(view, t.id, ty);
                }}
                className={`h-4 w-4 rounded-full ${(c?.type ?? "term") === ty ? "ring-2 ring-fg ring-offset-1 ring-offset-bg" : ""}`}
                style={{ background: TYPE_COLORS[ty] }}
              />
            ))}
          </div>
        ),
      },
      { kind: "separator" },
      { kind: "item", label: view === "global" ? "Delete everywhere" : "Remove from this note", icon: "trash", danger: true, onSelect: () => void ops.deleteElements(view, [t.id], []) },
    ];
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable='true']")) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && k === "y") {
      e.preventDefault();
      redo();
    } else if (e.key === "Escape" && fullscreen) {
      setFullscreen(false);
    }
  };

  const typesPresent = useMemo(
    () => [...new Set(data.concepts.map((c) => c.type ?? "term"))] as ConceptType[],
    [data.concepts],
  );

  return (
    <GraphContext.Provider value={actions}>
      <div
        ref={wrapper}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onDoubleClick={(e) => {
          // React Flow has no pane double-click event; detect it on the wrapper.
          if ((e.target as Element).classList.contains("react-flow__pane")) {
            const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
            void addAt({ x: p.x - 50, y: p.y - 20 });
          }
        }}
        className={`${fullscreen ? "fixed inset-0 z-50" : "relative h-full w-full"} @container bg-surface outline-none`}
      >
        <ReactFlow<ConceptFlowNode, RelationFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={(_, __, dragged) => saveMoves(dragged)}
          onSelectionDragStop={(_, dragged) => saveMoves(dragged)}
          onConnect={async (c) => {
            const id = await ops.addEdge(view, c.source, c.target);
            if (id) setEditing({ kind: "edge", id }); // ask for the relation right away
          }}
          onDelete={({ nodes: ns, edges: es }) => void ops.deleteElements(view, ns.map((n) => n.id), es.map((e) => e.id))}
          onNodeClick={(_, n) => setHighlightTerms(editor, termsOf(conceptById.get(n.id)))}
          onPaneClick={() => {
            setHighlightTerms(editor, []);
            wrapper.current?.focus({ preventScroll: true });
          }}
          onNodeDoubleClick={(_, n) => setEditing({ kind: "node", id: n.id })}
          onEdgeDoubleClick={(_, e) => setEditing({ kind: "edge", id: e.id })}
          onNodeContextMenu={(e, n) => actions.openMenu(e, { kind: "node", id: n.id })}
          onEdgeContextMenu={(e, ed) => actions.openMenu(e, { kind: "edge", id: ed.id })}
          onPaneContextMenu={(e) => {
            const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
            actions.openMenu(e as React.MouseEvent, { kind: "pane", flowX: p.x, flowY: p.y });
          }}
          connectionMode={ConnectionMode.Loose}
          deleteKeyCode={["Backspace", "Delete"]}
          zoomOnDoubleClick={false}
          colorMode={theme}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
          <MiniMap
            pannable
            zoomable
            position="bottom-left"
            className="hidden! sm:block!"
            style={{ width: 140, height: 90 }}
            nodeColor={(n) => (n.data as { color?: string }).color ?? "#888"}
          />

          <Panel position="top-left" className="flex gap-1 rounded-lg border border-border bg-bg p-1 shadow-sm">
            <ToolButton icon="plus" label="Add concept (or double-click the canvas)" onClick={addAtCenter} />
            <ToolButton icon="layout" label="Re-layout (pinned nodes stay put)" onClick={() => void doRelayout()} />
            <ToolButton icon="crosshair" label="Fit view" onClick={() => void rf.fitView({ duration: 300, padding: 0.15 })} />
            <span className="mx-0.5 w-px bg-border" />
            <ToolButton icon="undo" label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
            <ToolButton icon="redo" label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} />
            <span className="mx-0.5 w-px bg-border" />
            <ToolButton
              icon={fullscreen ? "minimize" : "maximize"}
              label={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
              onClick={() => setFullscreen((f) => !f)}
            />
          </Panel>

          {colorBy === "type" && typesPresent.length > 0 && (
            <Panel position="top-right" className="hidden flex-col gap-0.5 rounded-lg border border-border bg-bg/90 px-2 py-1.5 text-[11px] text-muted @md:flex">
              {typesPresent.map((ty) => (
                <span key={ty} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[ty] }} />
                  {TYPE_LABELS[ty]}
                </span>
              ))}
            </Panel>
          )}
        </ReactFlow>

        {data.concepts.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-muted">
            <p>
              No concepts yet.
              <br />
              Double-click the canvas or press + to add one.
            </p>
          </div>
        )}

        {toast && (
          <div className="absolute bottom-14 left-1/2 z-40 -translate-x-1/2 rounded-md bg-fg px-3 py-1.5 text-xs text-bg shadow">
            {toast}
          </div>
        )}

        {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />}
      </div>
    </GraphContext.Provider>
  );
}

function ToolButton({ icon, label, onClick, disabled }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <Icon name={icon} size={15} />
    </button>
  );
}
