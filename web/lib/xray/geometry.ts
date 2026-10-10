import { NODES, centerOf, viaPoints, type Point } from "./nodes";
import type { NodeId } from "./types";

export interface PathGeometry {
  /** SVG path data through every node of the step. */
  d: string;
  points: Point[];
  /** Fraction of the path (0..1) at which each path node is reached. */
  nodeAt: number[];
}

/** Where a path touches a node. Bars are entered right above or below the neighbours. */
function anchor(ids: NodeId[], i: number): Point {
  const id = ids[i]!;
  const node = NODES[id];
  const c = centerOf(id);
  if (!node.bar) return c;
  const xs: number[] = [];
  const prev = ids[i - 1];
  const next = ids[i + 1];
  if (prev && !NODES[prev].bar) xs.push(centerOf(prev).x);
  if (next && !NODES[next].bar) xs.push(centerOf(next).x);
  const x = xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : c.x;
  return { x: Math.min(node.x + node.w - 16, Math.max(node.x + 16, x)), y: c.y };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Catmull-Rom spline through the points, as cubic Bézier segments. */
function smooth(points: Point[]): string {
  const first = points[0];
  if (!first) return "";
  if (points.length === 1) return `M ${first.x} ${first.y}`;
  const t = 0.85;
  let d = `M ${round(first.x)} ${round(first.y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1 = { x: p1.x + ((p2.x - p0.x) / 6) * t, y: p1.y + ((p2.y - p0.y) / 6) * t };
    const c2 = { x: p2.x - ((p3.x - p1.x) / 6) * t, y: p2.y - ((p3.y - p1.y) / 6) * t };
    d += ` C ${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(p2.x)} ${round(p2.y)}`;
  }
  return d;
}

export function buildPath(ids: NodeId[]): PathGeometry {
  const points: Point[] = [];
  const nodeIndex: number[] = [];
  ids.forEach((id, i) => {
    const prev = ids[i - 1];
    if (prev) points.push(...viaPoints(prev, id));
    nodeIndex.push(points.length);
    points.push(anchor(ids, i));
  });
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1]! + distance(points[i - 1]!, points[i]!));
  }
  const total = cumulative[cumulative.length - 1] || 1;
  return {
    d: smooth(points),
    points,
    nodeAt: nodeIndex.map((p) => (cumulative[p] ?? 0) / total),
  };
}

/** Index of the last path node the signal has reached at progress p. */
export function nodeIndexAt(nodeAt: number[], p: number): number {
  let index = 0;
  nodeAt.forEach((fraction, i) => {
    if (p + 1e-6 >= fraction) index = i;
  });
  return index;
}
