import { Graph, layout } from "@dagrejs/dagre";

export type XY = { x: number; y: number };
export type LayoutNode = { id: string; width: number; height: number; pos?: XY; pinned?: boolean };
export type LayoutEdge = { source: string; target: string };

// Minimum clearance when nudging nodes apart. Must stay below dagre's nodesep,
// or nodes dagre placed correctly would count as overlapping and get scattered.
const GAP = 8;

/** Rough on-screen size of a concept node, so layout can run before React Flow measures anything. */
export function estimateNodeSize(label: string, scale = 1): { width: number; height: number } {
  return {
    width: Math.round(Math.min(240, Math.max(80, label.length * 7.4 + 34)) * scale),
    height: Math.round(38 * scale),
  };
}

/** dagre positions for every node, converted from dagre's centers to React Flow's top-left corners. */
function dagrePositions(nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, XY> {
  const g = new Graph<object, { width: number; height: number; x: number; y: number }, object>();
  // Left-to-right: siblings stack vertically, which fits the tall, narrow side panel.
  g.setGraph({ rankdir: "LR", nodesep: 16, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height, x: 0, y: 0 });
  for (const e of edges) {
    if (e.source !== e.target && g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  layout(g);
  const out = new Map<string, XY>();
  for (const n of nodes) {
    const p = g.node(n.id);
    out.set(n.id, { x: p.x - n.width / 2, y: p.y - n.height / 2 });
  }
  return out;
}

/** Average displacement from dagre's coordinates to where `anchors` really are. */
function alignment(anchors: LayoutNode[], ideal: Map<string, XY>): XY {
  if (!anchors.length) return { x: 0, y: 0 };
  let dx = 0;
  let dy = 0;
  for (const a of anchors) {
    const p = ideal.get(a.id)!;
    dx += a.pos!.x - p.x;
    dy += a.pos!.y - p.y;
  }
  return { x: dx / anchors.length, y: dy / anchors.length };
}

type Box = XY & { width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width + GAP && b.x < a.x + a.width + GAP && a.y < b.y + b.height + GAP && b.y < a.y + a.height + GAP;

/** Nearest free spot to `want`, searching outward along a golden-angle spiral. */
function freeSpot(want: XY, size: { width: number; height: number }, taken: Box[]): XY {
  for (let i = 0; i < 400; i++) {
    const r = 28 * Math.sqrt(i);
    const a = i * 2.39996;
    const p = { x: want.x + r * Math.cos(a), y: want.y + r * Math.sin(a) };
    if (!taken.some((b) => overlaps({ ...p, ...size }, b))) return p;
  }
  return want;
}

/**
 * Positions for nodes that don't have one yet (new concepts). Existing nodes
 * never move: we lay out the whole graph with dagre, shift that layout so it
 * lines up with the nodes already on screen, and drop each new node at its
 * dagre spot (or the nearest free space), so it lands next to its neighbours.
 */
export function placeNewNodes(nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, XY> {
  const fresh = nodes.filter((n) => !n.pos);
  if (!fresh.length) return new Map();
  const ideal = dagrePositions(nodes, edges);
  const placed = nodes.filter((n) => n.pos);
  const shift = alignment(placed, ideal);
  const taken: Box[] = placed.map((n) => ({ ...n.pos!, width: n.width, height: n.height }));
  const out = new Map<string, XY>();
  for (const n of fresh) {
    const p = ideal.get(n.id)!;
    const spot = freeSpot({ x: p.x + shift.x, y: p.y + shift.y }, n, taken);
    taken.push({ ...spot, width: n.width, height: n.height });
    out.set(n.id, spot);
  }
  return out;
}

/**
 * "Re-layout" button: unpinned nodes move to a fresh dagre layout; pinned nodes
 * stay exactly where the student put them. Returns positions for unpinned nodes only.
 */
export function relayout(nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, XY> {
  const ideal = dagrePositions(nodes, edges);
  const pinned = nodes.filter((n) => n.pinned && n.pos);
  // With pinned nodes, align to them; otherwise keep the graph's top-left corner where it was.
  let shift = alignment(pinned, ideal);
  if (!pinned.length) {
    const placed = nodes.filter((n) => n.pos);
    if (placed.length) {
      const minX = (ps: XY[]) => Math.min(...ps.map((p) => p.x));
      const minY = (ps: XY[]) => Math.min(...ps.map((p) => p.y));
      const now = placed.map((n) => n.pos!);
      const next = placed.map((n) => ideal.get(n.id)!);
      shift = { x: minX(now) - minX(next), y: minY(now) - minY(next) };
    }
  }
  const taken: Box[] = pinned.map((n) => ({ ...n.pos!, width: n.width, height: n.height }));
  const out = new Map<string, XY>();
  for (const n of nodes) {
    if (n.pinned && n.pos) continue;
    const p = ideal.get(n.id)!;
    const spot = freeSpot({ x: p.x + shift.x, y: p.y + shift.y }, n, taken);
    taken.push({ ...spot, width: n.width, height: n.height });
    out.set(n.id, spot);
  }
  return out;
}
