import { NODES, centerOf, type Point } from "./nodes";
import { route, type Route } from "./route";
import type { NodeId } from "./types";

// A step's route through the software map, drawn as numbered stops joined by
// arrows: each hop runs from the edge of one box to the edge of the next,
// straight, or around the boxes in the way (route.ts), rounded at its turns.
// The signal travels the whole route, through the boxes, so the hops and the
// moving signal share one geometry.

/** One hop of a route: from the box at stop i to the box at stop i + 1. */
export interface Hop {
  /** SVG path data, from the first box's edge to the next box's edge. */
  d: string;
  /** Where the hop starts and ends along the whole route, as fractions from 0 to 1. */
  from: number;
  to: number;
}

/** The stretch of a bar the signal runs along, between where the route meets it and where it leaves. */
export interface BarRun {
  /** The stop it belongs to, counted from 0. */
  stop: number;
  x1: number;
  x2: number;
  y: number;
  h: number;
  /** Where the run starts and ends along the whole route, as fractions from 0 to 1. */
  from: number;
  to: number;
}

export interface PathGeometry {
  /** SVG path data through every stop of the step, box centres included: what the signal follows. */
  d: string;
  points: Point[];
  /** Fraction of the path (0..1) at which each path node is reached. */
  nodeAt: number[];
  hops: Hop[];
  runs: BarRun[];
  /** Where each stop's number goes: on the box's top left corner, or on a bar where the route meets it. */
  badges: Point[];
}

/** A stop's number is a circle this big, centred on the box's corner. */
export const BADGE_RADIUS = 12;

/**
 * Where a path stops at a node: its centre, or, for a bar, where the route
 * from the stop before meets it and where the route to the next leaves it.
 * The signal runs along the bar between the two.
 */
function stops(id: NodeId, before: Route | undefined, after: Route | undefined): Point[] {
  if (!NODES[id].bar) return [centerOf(id)];
  const entry = before?.end ?? after?.start ?? centerOf(id);
  const exit = after?.start ?? entry;
  return Math.abs(entry.x - exit.x) < 0.5 ? [entry] : [entry, exit];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Straight lines through the points, each corner rounded a little. */
export function polyline(points: Point[], radius = 9): string {
  const first = points[0];
  if (!first) return "";
  let d = `M ${round(first.x)} ${round(first.y)}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const next = points[i + 1];
    if (!next) {
      d += ` L ${round(p.x)} ${round(p.y)}`;
      break;
    }
    const prev = points[i - 1]!;
    const r = Math.min(radius, distance(prev, p) / 2, distance(p, next) / 2);
    const inLen = distance(prev, p) || 1;
    const outLen = distance(p, next) || 1;
    const a = { x: p.x - ((p.x - prev.x) / inLen) * r, y: p.y - ((p.y - prev.y) / inLen) * r };
    const b = { x: p.x + ((next.x - p.x) / outLen) * r, y: p.y + ((next.y - p.y) / outLen) * r };
    d += ` L ${round(a.x)} ${round(a.y)} Q ${round(p.x)} ${round(p.y)} ${round(b.x)} ${round(b.y)}`;
  }
  return d;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const inside = (p: Point, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

/** Where the segment from a (inside the box) to b (outside it) crosses the box's edge. */
function exitPoint(a: Point, b: Point, r: Rect): Point {
  let t = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx > 0) t = Math.min(t, (r.x + r.w - a.x) / dx);
  if (dx < 0) t = Math.min(t, (r.x - a.x) / dx);
  if (dy > 0) t = Math.min(t, (r.y + r.h - a.y) / dy);
  if (dy < 0) t = Math.min(t, (r.y - a.y) / dy);
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/** Moves a point a little along the segment towards another, so a line stops short of a box's border. */
function toward(p: Point, q: Point, by: number): Point {
  const len = distance(p, q);
  if (len <= by) return p;
  return { x: p.x + ((q.x - p.x) / len) * by, y: p.y + ((q.y - p.y) / len) * by };
}

/**
 * A hop's own points, from box edge to box edge: the part of the route inside
 * either box is left out, so the line never runs over a box's label.
 */
function clipHop(points: Point[], from: Rect, to: Rect): Point[] {
  const pts = [...points];
  while (pts.length > 2 && inside(pts[1]!, from)) pts.shift();
  while (pts.length > 2 && inside(pts[pts.length - 2]!, to)) pts.pop();
  const first = pts[0]!;
  const second = pts[1]!;
  if (inside(first, from)) pts[0] = toward(exitPoint(first, second, from), second, 2);
  const last = pts[pts.length - 1]!;
  const before = pts[pts.length - 2]!;
  if (inside(last, to)) pts[pts.length - 1] = toward(exitPoint(last, before, to), before, 3);
  return pts;
}

/** Shifts points sideways, so a hop that goes back over an earlier one runs beside it. */
function offset(points: Point[], by: number): Point[] {
  const a = points[0]!;
  const b = points[points.length - 1]!;
  const len = distance(a, b) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  return points.map((p) => ({ x: p.x + nx * by, y: p.y + ny * by }));
}

export function buildPath(ids: NodeId[]): PathGeometry {
  const points: Point[] = [];
  const nodeIndex: number[] = [];
  const legs: Point[][] = [];
  const routes = ids.slice(1).map((id, i) => route(ids[i]!, id));
  const at = ids.map((id, i) => stops(id, routes[i - 1], routes[i]));
  ids.forEach((_, i) => {
    if (i > 0) {
      const via = routes[i - 1]!.via;
      points.push(...via);
      legs.push([at[i - 1]!.at(-1)!, ...via, at[i]![0]!]);
    }
    nodeIndex.push(points.length);
    points.push(...at[i]!);
  });
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1]! + distance(points[i - 1]!, points[i]!));
  }
  const total = cumulative[cumulative.length - 1] || 1;
  const nodeAt = nodeIndex.map((p) => (cumulative[p] ?? 0) / total);

  // A pair of boxes the route joins more than once gets lanes side by side.
  const lanes = new Map<string, number>();
  const hops = legs.map((leg, i): Hop => {
    const pair = [ids[i]!, ids[i + 1]!].sort().join(">");
    const lane = lanes.get(pair) ?? 0;
    lanes.set(pair, lane + 1);
    const clipped = clipHop(leg, NODES[ids[i]!], NODES[ids[i + 1]!]);
    return { d: polyline(lane === 0 ? clipped : offset(clipped, lane % 2 === 1 ? 7 : -7)), from: nodeAt[i]!, to: nodeAt[i + 1]! };
  });

  // Along a bar, the signal runs from where the route meets it to where it leaves.
  const runs: BarRun[] = [];
  ids.forEach((id, i) => {
    const node = NODES[id];
    const [entry, exit] = at[i]!;
    if (!node.bar || !entry || !exit) return;
    const p = nodeIndex[i]!;
    runs.push({
      stop: i,
      x1: entry.x,
      x2: exit.x,
      y: node.y,
      h: node.h,
      from: (cumulative[p] ?? 0) / total,
      to: (cumulative[p + 1] ?? 0) / total,
    });
  });

  // Each stop's number sits on its box's top left corner, clear of the label;
  // a box the route visits again gets the next number beside the first.
  const seen = new Map<NodeId, number>();
  const badges = ids.map((id, i): Point => {
    const node = NODES[id];
    const repeat = seen.get(id) ?? 0;
    seen.set(id, repeat + 1);
    const x = node.bar ? at[i]![0]!.x : node.x;
    return { x: x + repeat * (2 * BADGE_RADIUS + 4), y: node.y };
  });

  return { d: polyline(points), points, nodeAt, hops, runs, badges };
}

/** Index of the last path node the signal has reached at progress p. */
export function nodeIndexAt(nodeAt: number[], p: number): number {
  let index = 0;
  nodeAt.forEach((fraction, i) => {
    if (p + 1e-6 >= fraction) index = i;
  });
  return index;
}
