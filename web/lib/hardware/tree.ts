import { FIT_MARGIN, fit, visibleBox, type Camera, type Limits, type Point, type Size } from "./camera";
import { MACHINE } from "./hierarchy";
import type { Box, Link, Part } from "./types";

// The hierarchy placed in one world coordinate space, plus the questions the
// view asks about it while you zoom: which parts are big enough to show their
// children, which part is under the pointer, and which part you are looking at.

export interface Placed {
  /** Dotted path without the root, e.g. "cpu.core0.l1d"; the root's id is its key. */
  id: string;
  part: Part;
  parent: Placed | null;
  depth: number;
  /** The part's rectangle in world coordinates. */
  world: Box;
  /** World units per unit of the part's inner coordinates. */
  unit: number;
  children: Placed[];
  /** On-screen width (px) at which the children start to appear. */
  openAt: number;
}

export interface Tree {
  root: Placed;
  byId: Map<string, Placed>;
  /** Every part, each parent before its children. */
  all: Placed[];
}

/** Approximate width in pixels of a label at a font size (12 px by default), with a little padding. */
export function labelWidth(text: string, size = 12): number {
  return text.length * size * 0.567 + 8;
}

/** Sizes a part's name may shrink to, in pixels, before it moves under its box. */
const LABEL_SIZES = [12, 10.5, 9] as const;

/** How a part's name is shown at a zoom: the largest form that fits, never faded half way. */
export type LabelFit =
  | { place: "inside"; text: string; size: number; sub: boolean }
  | { place: "below"; lines: string[]; size: number }
  | { place: "none" };

/** Words packed into lines no wider than `width` pixels at a font size. */
function wrap(text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines[lines.length - 1];
    if (last !== undefined && labelWidth(`${last} ${word}`, size) <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

export function labelFit(p: Placed, k: number): LabelFit {
  const { part, world } = p;
  const vertical = isVertical(world);
  const along = (vertical ? world.h : world.w) * k;
  const across = (vertical ? world.w : world.h) * k;
  const names = part.short ? [part.label, part.short] : [part.label];
  for (const size of LABEL_SIZES) {
    if (across < size + 8) continue;
    for (const text of names) {
      if (labelWidth(text, size) > along) continue;
      const sub = size === 12 && part.sub !== undefined && across >= 44 && part.sub.length * 6 + 8 <= along;
      return { place: "inside", text, size, sub };
    }
  }
  // Parts of the whole computer always keep a name, under the box if need be,
  // wrapped to the box's width so neighbours' names do not run together.
  if (p.depth === 1) return { place: "below", lines: wrap(part.short ?? part.label, 10, Math.max(along + 12, 44)), size: 10 };
  return { place: "none" };
}

/** A link in world coordinates, and where its label goes: by the middle of its longest straight run. */
export interface LinkShape {
  points: Point[];
  label: { x: number; y: number; length: number; vertical: boolean; left: boolean };
}

const shapes = new Map<string, LinkShape>();

export function linkShape(parent: Placed, link: Link): LinkShape {
  const key = `${parent.id}:${link.id}`;
  const cached = shapes.get(key);
  if (cached) return cached;
  const points = link.points.map(([x, y]) => ({
    x: parent.world.x + x * parent.unit,
    y: parent.world.y + y * parent.unit,
  }));
  const left = link.labelSide === "left";
  let label = { x: 0, y: 0, length: 0, vertical: false, left };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > label.length) {
      label = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, length, vertical: a.x === b.x, left };
    }
  }
  const shape = { points, label };
  shapes.set(key, shape);
  return shape;
}

/** A link's label shows once its straight run is long enough on screen to hold it. */
export function linkLabelFits(parent: Placed, link: Link, k: number): boolean {
  const { label } = linkShape(parent, link);
  return label.length * k >= (label.vertical ? 40 : link.label.length * 6 + 8);
}

/** A tall, thin part (a RAM stick) gets its label written along its length. */
export function isVertical(box: Box): boolean {
  return box.h > box.w * 2.5;
}

// Children fade in while the part grows from OPEN_FROM to OPEN_FROM +
// OPEN_SPAN times its openAt width on screen.
const OPEN_FROM = 0.85;
const OPEN_SPAN = 0.3;
const MIN_OPEN_AT = 200;

/** A width at which every child's label (or short label) fits once the children are fully shown. */
function defaultOpenAt(part: Part): number {
  const inner = part.inner;
  if (!inner || !part.children?.length) return Number.POSITIVE_INFINITY;
  let need = 0;
  for (const child of part.children) {
    const room = isVertical(child.box) ? child.box.h : child.box.w;
    need = Math.max(need, (labelWidth(child.short ?? child.label) * inner.w) / room);
  }
  return Math.max(MIN_OPEN_AT, need / (OPEN_FROM + OPEN_SPAN));
}

export function placeTree(root: Part): Tree {
  const byId = new Map<string, Placed>();
  const all: Placed[] = [];

  function place(part: Part, parent: Placed | null, world: Box): Placed {
    const id = parent === null ? part.key : parent.depth === 0 ? part.key : `${parent.id}.${part.key}`;
    const unit = part.inner ? world.w / part.inner.w : 1;
    const node: Placed = {
      id,
      part,
      parent,
      depth: parent ? parent.depth + 1 : 0,
      world,
      unit,
      children: [],
      openAt: part.openAt ?? defaultOpenAt(part),
    };
    byId.set(id, node);
    all.push(node);
    for (const child of part.children ?? []) {
      node.children.push(
        place(child, node, {
          x: world.x + child.box.x * unit,
          y: world.y + child.box.y * unit,
          w: child.box.w * unit,
          h: child.box.h * unit,
        }),
      );
    }
    return node;
  }

  const placedRoot = place(root, null, root.box);
  return { root: placedRoot, byId, all };
}

export const TREE: Tree = placeTree(MACHINE);

/** The part and its ancestors, from the root down. */
export function lineage(p: Placed): Placed[] {
  const chain: Placed[] = [];
  for (let node: Placed | null = p; node; node = node.parent) chain.unshift(node);
  return chain;
}

/** The smallest box around all the boxes. */
export function unionBox(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** The deepest part that holds all the parts (or is one of them). */
export function commonAncestor(parts: Placed[]): Placed {
  const chains = parts.map(lineage);
  let shared = chains[0]![0]!;
  for (let i = 0; chains.every((c) => c[i] !== undefined && c[i] === chains[0]![i]); i++) shared = chains[0]![i]!;
  return shared;
}

export function contains(box: Box, p: Point): boolean {
  return p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
}

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** How far a part's children have faded in at zoom k: 0 not at all, 1 fully. */
export function openness(p: Placed, k: number): number {
  if (p.children.length === 0) return 0;
  if (p.depth === 0) return 1;
  return clamp01((p.world.w * k - OPEN_FROM * p.openAt) / (OPEN_SPAN * p.openAt));
}

/** The zoom at which a part's children are fully shown (0 for a part with none). */
export function fullyOpenZoom(p: Placed): number {
  if (p.children.length === 0) return 0;
  return ((OPEN_FROM + OPEN_SPAN) * p.openAt) / p.world.w;
}

/** The children's opacity as CSS, so it follows the --zoom variable without a React render. */
export function opennessCss(p: Placed): string {
  if (p.children.length === 0) return "0";
  if (p.depth === 0) return "1";
  const from = OPEN_FROM * p.openAt;
  const span = OPEN_SPAN * p.openAt;
  return `clamp(0, calc((var(--zoom) * ${round(p.world.w)} - ${round(from)}) / ${round(span)}), 1)`;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface Detail {
  /** Parts whose children are drawn. */
  open: Set<string>;
  /** Parts whose children are fully shown: what covered them (a CPU's lid) is gone. */
  full: Set<string>;
  /**
   * Parts on screen or close to it, drawn in full. The others among the
   * children of an open part are drawn as bare outlines, which keyboard
   * focus can still reach.
   */
  drawn: Set<string>;
  /** Parts you can click, tab to and hover: their parent is at least half faded in. */
  interactive: Set<string>;
  /** How each drawn part's name is shown. */
  labels: Map<string, LabelFit>;
  /** Links, as "parentId:linkId", whose labels fit. */
  linkLabels: Set<string>;
  /**
   * For each part, a signature of everything above for it and the parts
   * inside it: a part whose key did not change need not be drawn again.
   */
  keys: Map<string, string>;
  /** Changes whenever anything above does, so a frame that changes nothing renders nothing. */
  signature: string;
}

function fitKey(fit: LabelFit): string {
  if (fit.place === "none") return "-";
  if (fit.place === "below") return `b${fit.size}${fit.lines.join("/")}`;
  return `i${fit.size}${fit.text}${fit.sub ? "+" : ""}`;
}

/** What to draw for a camera: drawing only what is on screen and big enough keeps every frame cheap. */
export function levelOfDetail(tree: Tree, cam: Camera, view: Size): Detail {
  const seen = visibleBox(cam, view);
  const margin = { x: seen.x - seen.w / 4, y: seen.y - seen.h / 4, w: seen.w * 1.5, h: seen.h * 1.5 };
  const open = new Set<string>();
  const full = new Set<string>();
  const drawn = new Set<string>();
  const interactive = new Set<string>();
  const labels = new Map<string, LabelFit>();
  const linkLabels = new Set<string>();
  const keys = new Map<string, string>();

  /** Visits an open part's children; returns the signature of what is drawn inside it ("" when closed). */
  function visit(p: Placed, reachable: boolean): string {
    const o = openness(p, cam.k);
    if (o <= 0 || !intersects(p.world, margin)) return "";
    open.add(p.id);
    if (o >= 1) full.add(p.id);
    const signature = [o >= 1 ? "[=" : "["];
    for (const link of p.part.links ?? []) {
      if (!linkLabelFits(p, link, cam.k)) continue;
      linkLabels.add(`${p.id}:${link.id}`);
      signature.push(link.id);
    }
    const childrenReachable = reachable && o >= 0.5;
    for (const child of p.children) {
      if (childrenReachable) interactive.add(child.id);
      const near = intersects(child.world, margin);
      if (near) drawn.add(child.id);
      const fit = labelFit(child, cam.k);
      labels.set(child.id, fit);
      const key = `${child.part.key}${childrenReachable ? "!" : ""}${near ? "" : "~"}${fitKey(fit)}${visit(child, childrenReachable)}`;
      keys.set(child.id, key);
      signature.push(key);
    }
    signature.push("]");
    return signature.join(" ");
  }
  const signature = visit(tree.root, true);
  keys.set(tree.root.id, signature);
  return { open, full, drawn, interactive, labels, linkLabels, keys, signature };
}

/** The share of the view a part covers, from 0 to 1. */
export function coverage(p: Placed, cam: Camera, view: Size): number {
  const s = visibleBox(cam, view);
  const w = Math.max(0, Math.min(s.x + s.w, p.world.x + p.world.w) - Math.max(s.x, p.world.x));
  const h = Math.max(0, Math.min(s.y + s.h, p.world.y + p.world.h) - Math.max(s.y, p.world.y));
  return (w * h) / (s.w * s.h);
}

// You leave the part you are looking at when you zoom out below LEAVE times
// the zoom that frames it, and enter a child that covers ENTER of the view.
const LEAVE = 0.5;
const ENTER = 0.3;

/**
 * The part you are looking at after a zoom or a drag. Flying to a part makes
 * it the focus; moving by hand keeps that focus while you stay on it, moves up
 * when you leave it, and moves down into a child that fills much of the view.
 * `centre` is the world point in the middle of the free part of the view.
 */
export function refocus(
  tree: Tree,
  cam: Camera,
  view: Size,
  focusId: string,
  centre: Point = { x: cam.x, y: cam.y },
): Placed {
  let focus = tree.byId.get(focusId) ?? tree.root;
  while (focus.parent && (!contains(focus.world, centre) || cam.k < LEAVE * fit(focus.world, view).k)) {
    focus = focus.parent;
  }
  for (;;) {
    const child = focus.children.find((c) => contains(c.world, centre) && coverage(c, cam, view) >= ENTER);
    if (!child) return focus;
    focus = child;
  }
}

/** The deepest part under a world point that is shown clearly enough to be clicked. */
export function pickAt(tree: Tree, k: number, point: Point): Placed | null {
  let hit: Placed | null = null;
  let node = tree.root;
  while (openness(node, k) >= 0.5) {
    const child = node.children.find((c) => contains(c.world, point));
    if (!child) break;
    hit = child;
    node = child;
  }
  return hit;
}

/** How far you can zoom: out to a bit less than the whole computer, in to twice the smallest part. */
export function limitsFor(tree: Tree, view: Size): Limits {
  let maxK = 0;
  for (const p of tree.all) maxK = Math.max(maxK, fit(p.world, view, FIT_MARGIN).k);
  return {
    minK: fit(tree.root.world, view, FIT_MARGIN).k * 0.8,
    maxK: maxK * 2,
    bounds: tree.root.world,
  };
}
