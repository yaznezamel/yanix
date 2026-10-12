import { interpolateZoom } from "d3-interpolate";
import type { Box } from "./types";

// A 2D camera over the world: the world point at the centre of the view and
// the zoom, in screen pixels per world unit. Everything here is pure, so the
// component only has to turn a camera into one SVG transform per frame.

export interface Camera {
  x: number;
  y: number;
  k: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Room the view's overlays (breadcrumb, description) take up at each edge, in pixels. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface Limits {
  minK: number;
  maxK: number;
  /** The camera's centre stays inside this box. */
  bounds: Box;
}

/** Room left around a part when the camera frames it, as a fraction of the view. */
export const FIT_MARGIN = 0.06;

/** The longest a fly-to may take (the brief asks for under 500 ms). */
export const MAX_FLIGHT_MS = 450;
const MIN_FLIGHT_MS = 200;

/** The camera that frames a box in the part of the view the insets leave free, with a margin around it. */
export function fit(box: Box, view: Size, margin = FIT_MARGIN, insets: Insets = NO_INSETS): Camera {
  const free = {
    width: Math.max(1, view.width - insets.left - insets.right),
    height: Math.max(1, view.height - insets.top - insets.bottom),
  };
  const k = Math.min((free.width * (1 - 2 * margin)) / box.w, (free.height * (1 - 2 * margin)) / box.h);
  return centreOn(box, k, insets);
}

/** The camera at zoom k that puts a box's centre in the middle of the part of the view the insets leave free. */
export function centreOn(box: Box, k: number, insets: Insets = NO_INSETS): Camera {
  return {
    x: box.x + box.w / 2 - (insets.left - insets.right) / (2 * k),
    y: box.y + box.h / 2 - (insets.top - insets.bottom) / (2 * k),
    k,
  };
}

/** The middle of the part of the view the insets leave free, in screen pixels. */
export function freeCentre(view: Size, insets: Insets): Point {
  return {
    x: insets.left + (view.width - insets.left - insets.right) / 2,
    y: insets.top + (view.height - insets.top - insets.bottom) / 2,
  };
}

export function toScreen(cam: Camera, view: Size, p: Point): Point {
  return { x: (p.x - cam.x) * cam.k + view.width / 2, y: (p.y - cam.y) * cam.k + view.height / 2 };
}

export function toWorld(cam: Camera, view: Size, p: Point): Point {
  return { x: (p.x - view.width / 2) / cam.k + cam.x, y: (p.y - view.height / 2) / cam.k + cam.y };
}

/** The part of the world the view shows. */
export function visibleBox(cam: Camera, view: Size): Box {
  const w = view.width / cam.k;
  const h = view.height / cam.k;
  return { x: cam.x - w / 2, y: cam.y - h / 2, w, h };
}

export function clampCamera(cam: Camera, limits: Limits): Camera {
  const b = limits.bounds;
  return {
    k: Math.min(limits.maxK, Math.max(limits.minK, cam.k)),
    x: Math.min(b.x + b.w, Math.max(b.x, cam.x)),
    y: Math.min(b.y + b.h, Math.max(b.y, cam.y)),
  };
}

/** Zoom by a factor, keeping the world point under `anchor` (in screen pixels) where it is. */
export function zoomAround(cam: Camera, view: Size, factor: number, anchor: Point, limits: Limits): Camera {
  const k = Math.min(limits.maxK, Math.max(limits.minK, cam.k * factor));
  const p = toWorld(cam, view, anchor);
  return clampCamera(
    { k, x: p.x - (anchor.x - view.width / 2) / k, y: p.y - (anchor.y - view.height / 2) / k },
    limits,
  );
}

/** Move the world by a drag of (dx, dy) screen pixels. */
export function panBy(cam: Camera, dx: number, dy: number, limits: Limits): Camera {
  return clampCamera({ ...cam, x: cam.x - dx / cam.k, y: cam.y - dy / cam.k }, limits);
}

/** The SVG transform that maps world coordinates to the view. */
export function cameraTransform(cam: Camera, view: Size): string {
  const tx = view.width / 2 - cam.x * cam.k;
  const ty = view.height / 2 - cam.y * cam.k;
  return `matrix(${cam.k} 0 0 ${cam.k} ${tx} ${ty})`;
}

export interface Flight {
  /** Milliseconds, at most MAX_FLIGHT_MS. */
  duration: number;
  /** The camera at time t, from 0 (start) to 1 (arrived). */
  at: (t: number) => Camera;
}

/**
 * A smooth zoom and pan between two cameras (van Wijk and Nuij's path, as in
 * d3-zoom): it zooms out a little on long moves, so you keep your bearings.
 */
export function flight(from: Camera, to: Camera, view: Size): Flight {
  const zoom = interpolateZoom([from.x, from.y, view.width / from.k], [to.x, to.y, view.width / to.k]);
  const same = from.x === to.x && from.y === to.y && from.k === to.k;
  return {
    duration: same ? 0 : Math.min(MAX_FLIGHT_MS, Math.max(MIN_FLIGHT_MS, zoom.duration * 0.4)),
    at(t) {
      if (t >= 1) return to;
      const [x, y, w] = zoom(t);
      return { x, y, k: view.width / w };
    },
  };
}

/** A box in world coordinates, on screen. */
export function screenBox(cam: Camera, view: Size, box: Box): Box {
  const a = toScreen(cam, view, { x: box.x, y: box.y });
  return { x: a.x, y: a.y, w: box.w * cam.k, h: box.h * cam.k };
}

/**
 * Where a card goes beside a box on screen (a pointer is a box of no size):
 * to its right, else its left, else below or above it, and always inside the
 * view. A box too big for any of those gets the card in its top corner.
 */
export function placeBeside(anchor: Box, card: Size, view: Size, gap = 10, margin = 8): Point {
  const maxX = Math.max(margin, view.width - margin - card.width);
  const maxY = Math.max(margin, view.height - margin - card.height);
  const clampX = (x: number) => Math.min(maxX, Math.max(margin, x));
  const clampY = (y: number) => Math.min(maxY, Math.max(margin, y));
  const right = anchor.x + anchor.w + gap;
  if (right + card.width <= view.width - margin) return { x: right, y: clampY(anchor.y) };
  const left = anchor.x - gap - card.width;
  if (left >= margin) return { x: left, y: clampY(anchor.y) };
  const below = anchor.y + anchor.h + gap;
  if (below + card.height <= view.height - margin) return { x: clampX(anchor.x), y: below };
  const above = anchor.y - gap - card.height;
  if (above >= margin) return { x: clampX(anchor.x), y: above };
  return { x: clampX(anchor.x + gap), y: clampY(anchor.y + gap) };
}
