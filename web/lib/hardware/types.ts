// Types for the hardware view: a tree of parts, each drawn inside its parent,
// that you zoom into from the whole computer down to the units of a CPU core.
// The tree is plain data (hierarchy.ts); it moves to content/*.yaml with the
// lab's scenarios once the catalog API exists (FR12).

import type { NodeId } from "@/lib/xray/types";

/** A rectangle: position of the top left corner, width and height. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a part is. Phase 2 picks a drawing per kind; until then all are boxes. */
export type PartKind =
  | "machine"
  | "package"
  | "chip"
  | "module"
  | "card"
  | "peripheral"
  | "network"
  | "block"
  | "core"
  | "cache"
  | "unit";

/** A wire, bus or cable between two children of the same part. */
export interface Link {
  /** Unique among the part's links. */
  id: string;
  /** Keys of the two children it connects. */
  from: string;
  to: string;
  label: string;
  /** Polyline in the parent's inner coordinates, from `from` to `to`. */
  points: [number, number][];
}

/** A labelled outline that groups children visually, such as the motherboard. */
export interface Frame {
  label: string;
  box: Box;
}

export interface Part {
  /** Unique among its siblings: lowercase letters, digits and dashes. */
  key: string;
  label: string;
  /** Shown instead of the label while the part is too small for it on screen. */
  short?: string;
  /** Short second line under the label. */
  sub?: string;
  kind: PartKind;
  /** Where the part sits in its parent's inner coordinates. */
  box: Box;
  /** Size of the part's own coordinate space, in which its children are placed. Same aspect ratio as `box`. */
  inner?: { w: number; h: number };
  children?: Part[];
  links?: Link[];
  frames?: Frame[];
  /** What the part is and does, in a sentence or three (shown on hover and in the view's footer). */
  about: string;
  /** Lab map nodes this part stands for: it lights up when a trace reaches them. */
  maps?: NodeId[];
  /** Software in these layers runs on this part (the CPU runs user programs and the kernel). */
  runs?: ("user" | "kernel")[];
  /**
   * On-screen width, in pixels, at which the children start to appear.
   * Defaults to a width at which the narrowest child gets room for its label.
   */
  openAt?: number;
}
