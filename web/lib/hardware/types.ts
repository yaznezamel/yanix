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

/** What a part is. */
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

/**
 * How a part is drawn (components/hardware/art). Parts without one are drawn
 * by their kind: a block or a unit as logic, a cache as memory cells, and a
 * part with parts of its own as those parts.
 */
export type Look =
  /** A processor package: a metal lid, and the die under it. */
  | "cpu"
  /** A memory module: DRAM chips on a small board. */
  | "dimm"
  /** An M.2 card: a controller and flash chips. */
  | "m2"
  /** A small eight-pin flash chip. */
  | "flash"
  /** A network chip and its RJ45 jack. */
  | "nic"
  /** A chip under a heatsink. */
  | "chipset"
  /** An audio chip and its jacks. */
  | "codec"
  /** A graphics card with two fans. */
  | "gpu"
  /** A router, and the internet behind it. */
  | "router"
  /** A keyboard and a mouse. */
  | "input"
  | "speakers"
  | "monitor"
  /** Standard cells, as a photo of a die shows logic. */
  | "logic"
  /** Arrays of memory cells. */
  | "sram"
  /** A register file: small, many-ported memory. */
  | "regfile"
  /** An on-chip ring bus. */
  | "ring"
  /** Logic with a PHY along its bottom edge: the circuits that drive a bus off the chip. */
  | "phy";

/** A cable outside the case, drawn as a cable rather than as wires on a board. */
export type Cable = "ethernet" | "usb" | "audio" | "display";

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
  /**
   * Where the link arrives inside an end that has parts of its own, by that
   * end's key: { cpu: "io" } means it reaches the CPU's I/O block.
   */
  enters?: Record<string, string>;
  /** Which side of a vertical link its label goes on (right by default). */
  labelSide?: "left" | "right";
  /** Where along its longest straight run the label goes, from 0 to 1 (the middle by default). */
  labelAt?: number;
  /** A cable outside the case; other links are wires on a board. */
  cable?: Cable;
}

/** A labelled outline that groups children visually, such as the motherboard. */
export interface Frame {
  label: string;
  box: Box;
  /** A circuit board, or the space around the computer. */
  kind: "board" | "outside";
}

/**
 * Something on a board that is drawn but not part of the model, such as the
 * power connector or the battery: it makes the board look like one, and
 * cannot be clicked.
 */
export interface Decor {
  kind: "socket" | "slot" | "vrm" | "io" | "power" | "battery" | "sata" | "hole" | "caps" | "silk";
  box: Box;
  /** For "silk": the text printed on the board. */
  text?: string;
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
  look?: Look;
  /** Where the part sits in its parent's inner coordinates. */
  box: Box;
  /** Size of the part's own coordinate space, in which its children are placed. Same aspect ratio as `box`. */
  inner?: { w: number; h: number };
  children?: Part[];
  links?: Link[];
  frames?: Frame[];
  /** Drawn on the part's own board, under its children. */
  decor?: Decor[];
  /** What the part is and does, in a sentence or three (shown on hover and in the view's footer). */
  about: string;
  /** Lab map nodes this part stands for: it lights up when a trace reaches them. */
  maps?: NodeId[];
  /** Software in these layers runs on this part (a CPU core runs user programs and the kernel). */
  runs?: ("user" | "kernel")[];
  /** The child that connects the other children, such as a CPU's interconnect. */
  hub?: string;
  /**
   * On-screen width, in pixels, at which the children start to appear.
   * Defaults to a width at which the narrowest child gets room for its label.
   */
  openAt?: number;
}
