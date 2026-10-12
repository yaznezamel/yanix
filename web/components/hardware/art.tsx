import type { ReactNode } from "react";
import {
  bankGaps,
  bundle,
  fanBlades,
  gridPath,
  hashSeed,
  logicCells,
  lookOf,
  packagePins,
  polylinePath,
  rails,
  rectsPath,
  routing,
  rowsPath,
  spread,
  stripes,
} from "@/lib/hardware/art";
import type { Point } from "@/lib/hardware/camera";
import { strokeText } from "@/lib/hardware/strokeFont";
import type { Placed } from "@/lib/hardware/tree";
import type { Box, Cable, Decor, Look, Part } from "@/lib/hardware/types";

// The hardware drawings. Each part is drawn by its look (lib/hardware/types.ts)
// inside its own box, in world units, so a drawing grows with the zoom as a
// photo would; only outlines keep their width on screen. A look has up to
// three layers:
// - base: always drawn, such as a chip and its pins;
// - open: drawn once the part shows its children, under them (a CPU's die);
// - cover: what hides the children, fading out as they fade in (a CPU's lid).
// A part with children and no cover is drawn as its children's drawings until
// they are fully shown, so zooming into it only adds their names and outlines.
// No SVG filters, and each texture is a few paths, to keep zooming smooth.

export interface Art {
  base?: ReactNode;
  open?: ReactNode;
  cover?: ReactNode;
}

const LINE = { vectorEffect: "non-scaling-stroke" } as const;

const MODULE_PCB = "#0f3d2b";
const MODULE_EDGE = "#1f6045";
/** The motherboard, seen through notches and holes. */
const BOARD = "#0f2c25";
const PACKAGE = "#16181c";
const PACKAGE_EDGE = "#2b2f35";
const PIN = "#9aa1aa";
const GOLD = "#d4ac4a";
const PLASTIC = "#1b1f25";
const PLASTIC_EDGE = "#3a414b";
const DIE_EDGE = "#4a5068";
const LOGIC_SHADES = ["#34405e", "#2b3450", "#3e4969", "#2e3550", "#443d66"];

export const CABLE: Record<Cable, { body: string; shine: string }> = {
  ethernet: { body: "#2f68c8", shine: "#6f9ce6" },
  usb: { body: "#2b2f36", shine: "#4f5661" },
  audio: { body: "#2b2f36", shine: "#4f5661" },
  display: { body: "#2b2f36", shine: "#4f5661" },
};

// Path data depends only on a part's size, so it is worked out once.
const shapes = new Map<string, unknown>();
function once<T>(key: string, make: () => T): T {
  let value = shapes.get(key) as T | undefined;
  if (value === undefined) {
    value = make();
    shapes.set(key, value);
  }
  return value;
}

/** Gradients the drawings share. */
export function ArtDefs() {
  return (
    <defs>
      <linearGradient id="hw-pcb" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#143a30" />
        <stop offset="0.6" stopColor="#0f2c25" />
        <stop offset="1" stopColor="#0b221c" />
      </linearGradient>
      <linearGradient id="hw-metal" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#e4e7ea" />
        <stop offset="0.45" stopColor="#aab1b9" />
        <stop offset="0.7" stopColor="#d2d6db" />
        <stop offset="1" stopColor="#959ca5" />
      </linearGradient>
      <linearGradient id="hw-die" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#1b2030" />
        <stop offset="0.5" stopColor="#232840" />
        <stop offset="1" stopColor="#2a2340" />
      </linearGradient>
      <linearGradient id="hw-sheen" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#7fd8ff" stopOpacity="0" />
        <stop offset="0.5" stopColor="#b48cff" stopOpacity="0.1" />
        <stop offset="1" stopColor="#7fffd0" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="hw-screen" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#2a5585" />
        <stop offset="0.55" stopColor="#173055" />
        <stop offset="1" stopColor="#0d1a30" />
      </linearGradient>
    </defs>
  );
}

// ——— Textures ———————————————————————————————————————————————————————————

/** Standard-cell logic, as a photo of a die shows it. */
function Logic({ w, h, seed, base = "#232a3a" }: { w: number; h: number; seed: number; base?: string }) {
  const d = once(`logic ${seed} ${w} ${h}`, () => {
    const s = Math.min(Math.sqrt(w * h) / 6, Math.min(w, h) * 0.45);
    return {
      cells: logicCells(w, h, seed, LOGIC_SHADES.length, 60).map(rectsPath),
      rows: rowsPath(w, h, s * 0.14),
      rails: rectsPath(rails(w, h, Math.max(2, Math.round((h / s) * 1.2)), Math.min(w, h) * 0.012)),
    };
  });
  return (
    <>
      <rect width={w} height={h} fill={base} stroke="#3a4256" {...LINE} />
      {d.cells.map((cells, i) => (
        <path key={i} d={cells} fill={LOGIC_SHADES[i]} fillOpacity={0.9} />
      ))}
      <path d={d.rows} fill="none" stroke="#9aa6d0" strokeOpacity={0.08} {...LINE} />
      <path d={d.rails} fill="#5d6990" fillOpacity={0.4} />
    </>
  );
}

const CELL_TONES = {
  sram: { base: "#2b2846", grid: "#463f70", gap: "#1a1830", edge: "#4b4675" },
  regfile: { base: "#25304a", grid: "#3b4d78", gap: "#182033", edge: "#3b4d78" },
} as const;

/** Arrays of memory cells, split into banks. */
function Cells({ w, h, tone }: { w: number; h: number; tone: keyof typeof CELL_TONES }) {
  const t = CELL_TONES[tone];
  const d = once(`cells ${w} ${h}`, () => {
    const m = Math.min(w, h);
    const cols = Math.min(6, Math.max(2, Math.round(w / h)));
    return { grid: gridPath(w, h, m / 10), gaps: rectsPath(bankGaps(w, h, cols, 2, m * 0.04)) };
  });
  return (
    <>
      <rect width={w} height={h} fill={t.base} />
      <path d={d.grid} fill="none" stroke={t.grid} {...LINE} />
      <path d={d.gaps} fill={t.gap} />
      <rect width={w} height={h} fill="none" stroke={t.edge} {...LINE} />
    </>
  );
}

/** Chip packages: a black body with a faint inner edge, as one path for all of them. */
function Packages({ id, boxes }: { id: string; boxes: Box[] }) {
  const d = once(`packages ${id}`, () => ({
    bodies: rectsPath(boxes),
    edges: rectsPath(
      boxes.map((b) => {
        const i = Math.min(b.w, b.h) * 0.1;
        return { x: b.x + i, y: b.y + i, w: b.w - 2 * i, h: b.h - 2 * i };
      }),
    ),
  }));
  return (
    <>
      <path d={d.bodies} fill={PACKAGE} stroke={PACKAGE_EDGE} {...LINE} />
      <path d={d.edges} fill="none" stroke="#2c3139" {...LINE} />
    </>
  );
}

/** A square chip with pins on all four sides. */
function PinnedChip({ id, body, perSide }: { id: string; body: Box; perSide: number }) {
  const pins = once(`pins ${id}`, () => rectsPath(packagePins(body, perSide, body.w * 0.09, body.w * 0.045)));
  return (
    <>
      <path d={pins} fill={PIN} />
      <rect {...rect(body)} rx={body.w * 0.03} fill={PACKAGE} stroke={PACKAGE_EDGE} {...LINE} />
      <circle cx={body.x + body.w * 0.16} cy={body.y + body.h * 0.16} r={body.w * 0.05} fill="#3a3f47" />
    </>
  );
}

/**
 * Writing on the hardware, in a stroke font (lib/hardware/strokeFont.ts):
 * `y` is the top of the capitals, `size` their height, and `weight` the
 * stroke's width as a share of it.
 */
function Lettering({
  text,
  x,
  y,
  size,
  color,
  anchor = "middle",
  weight = 0.12,
}: {
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  anchor?: "start" | "middle";
  weight?: number;
}) {
  const d = once(`lettering ${text} ${x} ${y} ${size} ${anchor}`, () => strokeText(text, x, y, size, { anchor }));
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={size * weight}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function rect(b: Box) {
  return { x: b.x, y: b.y, width: b.w, height: b.h };
}

/** A die: dark silicon with a faint rainbow sheen, inside a package. */
function Die({ box }: { box: Box }) {
  return (
    <>
      <rect {...rect(box)} fill="url(#hw-die)" stroke={DIE_EDGE} {...LINE} />
      <rect {...rect(box)} fill="url(#hw-sheen)" />
    </>
  );
}

// ——— Looks ——————————————————————————————————————————————————————————————

type Draw = (w: number, h: number, part: Part) => Art;

const DRAW: Record<Look, Draw> = {
  cpu(w, h) {
    const caps = spread({ x: w * 0.52, y: h * 0.025, w: w * 0.44, h: h * 0.035 }, 9, w * 0.022, false);
    return {
      base: (
        <>
          <rect width={w} height={h} rx={w * 0.03} fill="#1d3a2b" stroke="#2d5442" {...LINE} />
          <path d={rectsPath(caps)} fill="#c69a3c" fillOpacity={0.85} />
        </>
      ),
      open: <Die box={{ x: w * 0.035, y: h * 0.085, w: w * 0.93, h: h * 0.88 }} />,
      cover: (
        <>
          <rect
            x={w * 0.08}
            y={h * 0.08}
            width={w * 0.84}
            height={h * 0.84}
            rx={w * 0.07}
            fill="url(#hw-metal)"
            stroke="#7f8790"
            {...LINE}
          />
          <path d={`M${w * 0.12} ${h * 0.88}h${w * 0.07}l${-w * 0.07} ${-h * 0.07}z`} fill="#868d96" />
          <Lettering text="YANIX" x={w / 2} y={h * 0.44} size={w * 0.08} color="#646b74" weight={0.16} />
          <Lettering text="TEACHING CPU" x={w / 2} y={h * 0.58} size={w * 0.032} color="#646b74" />
          <Lettering text="4 CORES · ILLUSTRATIVE" x={w / 2} y={h * 0.655} size={w * 0.024} color="#757c85" />
        </>
      ),
    };
  },

  chipset(w, h) {
    const fins = once(`fins ${w} ${h}`, () =>
      rectsPath(stripes({ x: w * 0.1, y: h * 0.1, w: w * 0.8, h: h * 0.8 }, h * 0.065, 0.5, false)),
    );
    return {
      base: <rect width={w} height={h} rx={w * 0.03} fill="#1d3a2b" stroke="#2d5442" {...LINE} />,
      open: <Die box={{ x: w * 0.04, y: h * 0.1, w: w * 0.92, h: h * 0.86 }} />,
      cover: (
        <>
          <rect
            x={w * 0.03}
            y={h * 0.03}
            width={w * 0.94}
            height={h * 0.94}
            rx={w * 0.05}
            fill="#2f353d"
            stroke="#6b737e"
            {...LINE}
          />
          <path d={fins} fill="#535b66" />
          <rect x={w * 0.3} y={h * 0.42} width={w * 0.4} height={h * 0.16} rx={w * 0.02} fill="#20252b" stroke="#59616c" {...LINE} />
        </>
      ),
    };
  },

  dimm(w, h) {
    // Drawn standing: the chips down the stick, the gold contacts along its left edge.
    const d = once(`dimm ${w} ${h}`, () => ({
      chips: spread({ x: w * 0.26, y: 0, w: w * 0.6, h }, 8, h * 0.094, true),
      gold: rectsPath(stripes({ x: 0, y: h * 0.03, w: w * 0.11, h: h * 0.94 }, h * 0.0125, 0.6, false)),
    }));
    return {
      base: (
        <>
          <rect width={w} height={h} rx={w * 0.05} fill={MODULE_PCB} stroke={MODULE_EDGE} {...LINE} />
          <path d={d.gold} fill={GOLD} />
          <rect y={h * 0.57} width={w * 0.13} height={h * 0.022} fill={BOARD} />
          <Packages id={`dimm ${w} ${h}`} boxes={d.chips} />
        </>
      ),
    };
  },

  m2(w, h) {
    // The gold contacts at the end that plugs into the board, by the CPU; the screw at the other.
    const d = once(`m2 ${w} ${h}`, () => ({
      chips: [
        { x: w * 0.08, y: h * 0.12, w: w * 0.21, h: h * 0.76 },
        { x: w * 0.32, y: h * 0.12, w: w * 0.21, h: h * 0.76 },
        { x: w * 0.57, y: h * 0.26, w: w * 0.07, h: h * 0.48 },
        { x: w * 0.68, y: h * 0.17, w: w * 0.18, h: h * 0.66 },
      ],
      gold: rectsPath(stripes({ x: w * 0.935, y: h * 0.08, w: w * 0.065, h: h * 0.84 }, h * 0.075, 0.6, false)),
    }));
    return {
      base: (
        <>
          <rect width={w} height={h} rx={h * 0.08} fill={MODULE_PCB} stroke={MODULE_EDGE} {...LINE} />
          <path d={d.gold} fill={GOLD} />
          <rect x={w * 0.93} y={h * 0.64} width={w * 0.07} height={h * 0.07} fill={BOARD} />
          <Packages id={`m2 ${w} ${h}`} boxes={d.chips} />
          <circle cy={h / 2} r={h * 0.17} fill={BOARD} />
          <circle cy={h / 2} r={h * 0.12} fill="url(#hw-metal)" stroke="#7f8790" {...LINE} />
        </>
      ),
    };
  },

  flash(w, h) {
    // An eight-pin SOIC package, four legs on each long side.
    const body = { x: w * 0.34, y: h * 0.25, w: w * 0.32, h: h * 0.5 };
    const legs = once(`flash ${w} ${h}`, () =>
      rectsPath([
        ...spread({ x: body.x, y: body.y - h * 0.12, w: body.w, h: h * 0.12 }, 4, body.w * 0.11, false),
        ...spread({ x: body.x, y: body.y + body.h, w: body.w, h: h * 0.12 }, 4, body.w * 0.11, false),
      ]),
    );
    return {
      base: (
        <>
          <path d={legs} fill={PIN} />
          <rect {...rect(body)} rx={body.h * 0.05} fill={PACKAGE} stroke={PACKAGE_EDGE} {...LINE} />
          <circle cx={body.x + body.w * 0.13} cy={body.y + body.h * 0.24} r={body.h * 0.08} fill="#3a3f47" />
        </>
      ),
    };
  },

  nic(w, h) {
    const body = { x: w * 0.31, y: h * 0.1, w: w * 0.38, h: w * 0.38 };
    return {
      base: (
        <>
          <PinnedChip id={`nic ${w} ${h}`} body={body} perSide={8} />
          <rect x={w * 0.07} y={h * 0.17} width={w * 0.14} height={h * 0.1} rx={h * 0.05} fill="url(#hw-metal)" stroke="#7f8790" {...LINE} />
          {/* The RJ45 jack the cable plugs into. */}
          <rect x={w * 0.28} y={h * 0.66} width={w * 0.44} height={h * 0.34} rx={w * 0.01} fill="url(#hw-metal)" stroke="#7f8790" {...LINE} />
          <rect x={w * 0.36} y={h * 0.74} width={w * 0.28} height={h * 0.22} fill="#0b0d10" />
          <rect x={w * 0.3} y={h * 0.68} width={w * 0.05} height={h * 0.04} fill="#36d36b" />
          <rect x={w * 0.65} y={h * 0.68} width={w * 0.05} height={h * 0.04} fill="#f5b638" />
        </>
      ),
    };
  },

  codec(w, h) {
    const body = { x: w * 0.33, y: h * 0.12, w: w * 0.34, h: w * 0.34 };
    const caps = [
      [w * 0.14, h * 0.24],
      [w * 0.14, h * 0.47],
      [w * 0.86, h * 0.24],
    ] as const;
    const jacks = [
      [w * 0.67, "#4cc36a"],
      [w * 0.79, "#ff7fb2"],
      [w * 0.91, "#4aa3ff"],
    ] as const;
    return {
      base: (
        <>
          <PinnedChip id={`codec ${w} ${h}`} body={body} perSide={7} />
          {caps.map(([cx, cy]) => (
            <g key={`${cx} ${cy}`}>
              <circle cx={cx} cy={cy} r={w * 0.075} fill="#2b2f36" stroke="#8b929b" {...LINE} />
              <circle cx={cx} cy={cy} r={w * 0.05} fill="#b9965a" />
            </g>
          ))}
          {/* The jacks the speakers plug into. */}
          <rect x={w * 0.6} y={h * 0.66} width={w * 0.38} height={h * 0.32} rx={w * 0.02} fill="#1b1e22" stroke="#3a4049" {...LINE} />
          {jacks.map(([cx, color]) => (
            <g key={color}>
              <circle cx={cx} cy={h * 0.82} r={w * 0.045} fill={color} />
              <circle cx={cx} cy={h * 0.82} r={w * 0.02} fill="#111" />
            </g>
          ))}
        </>
      ),
    };
  },

  gpu(w, h) {
    const cy = h * 0.49;
    const r = h * 0.3;
    const fans = [w * 0.29, w * 0.71];
    const d = once(`gpu ${w} ${h}`, () => ({
      blades: fans.map((cx) => fanBlades(cx, cy, r * 0.92, r * 0.32, 9)).join(""),
      // The PCIe contacts, on the edge that faces the CPU's x16 link.
      fingers: rectsPath(stripes({ x: w * 0.32, y: 0, w: w * 0.4, h: h * 0.07 }, w * 0.011, 0.55, true)),
    }));
    return {
      base: (
        <>
          <rect y={h * 0.05} width={w} height={h * 0.9} rx={h * 0.04} fill="#1c211f" stroke="#33403a" {...LINE} />
          <path d={d.fingers} fill={GOLD} />
          <rect x={w * 0.02} y={h * 0.11} width={w * 0.96} height={h * 0.76} rx={h * 0.09} fill="#23272e" stroke="#4a515b" {...LINE} />
          <rect x={w * 0.05} y={h * 0.15} width={w * 0.9} height={h * 0.035} rx={h * 0.017} fill="#30353e" />
          {fans.map((cx) => (
            <circle key={cx} cx={cx} cy={cy} r={r} fill="#14171b" stroke="#4a515b" {...LINE} />
          ))}
          <path d={d.blades} fill="#3a4049" />
          {fans.map((cx) => (
            <circle key={cx} cx={cx} cy={cy} r={r * 0.3} fill="#2b3037" stroke="#59616c" {...LINE} />
          ))}
          {/* Display outputs, where the cable to the monitor leaves. */}
          <rect x={w * 0.52} y={h * 0.9} width={w * 0.14} height={h * 0.08} rx={h * 0.01} fill="#2a2e35" stroke="#59616c" {...LINE} />
        </>
      ),
    };
  },

  router(w, h) {
    const leds = [0, 1, 2, 3].map((i) => ({ x: w * (0.19 + i * 0.07), y: h * 0.7, w: w * 0.03, h: h * 0.03 }));
    const c = { x: w * 0.5, y: h * 0.1, w: w * 0.46, h: h * 0.38 };
    // A cloud: a flat bottom and four bumps.
    const cloud =
      `M${c.x + c.w * 0.14} ${c.y + c.h * 0.95}` +
      `A${c.w * 0.16} ${c.h * 0.24} 0 0 1 ${c.x + c.w * 0.22} ${c.y + c.h * 0.5}` +
      `A${c.w * 0.24} ${c.h * 0.36} 0 0 1 ${c.x + c.w * 0.62} ${c.y + c.h * 0.32}` +
      `A${c.w * 0.18} ${c.h * 0.28} 0 0 1 ${c.x + c.w * 0.88} ${c.y + c.h * 0.6}` +
      `A${c.w * 0.12} ${c.h * 0.18} 0 0 1 ${c.x + c.w * 0.86} ${c.y + c.h * 0.95}z`;
    return {
      base: (
        <>
          <path d={cloud} fill="#162130" stroke="#3d5878" {...LINE} />
          <path
            d={`M${w * 0.72} ${h * 0.68}C${w * 0.8} ${h * 0.68} ${w * 0.8} ${h * 0.56} ${w * 0.76} ${h * 0.47}`}
            fill="none"
            stroke="#4d6d92"
            strokeDasharray="3 3"
            {...LINE}
          />
          <path d={`M${w * 0.5} 0V${h * 0.58}`} stroke={CABLE.ethernet.body} strokeWidth={7} strokeLinecap="round" />
          <path
            d={`M${w * 0.21} ${h * 0.6}L${w * 0.16} ${h * 0.34}M${w * 0.63} ${h * 0.6}L${w * 0.68} ${h * 0.34}`}
            stroke="#3a414b"
            strokeWidth={w * 0.025}
            strokeLinecap="round"
          />
          <rect x={w * 0.1} y={h * 0.58} width={w * 0.62} height={h * 0.26} rx={w * 0.04} fill={PLASTIC} stroke={PLASTIC_EDGE} {...LINE} />
          <path d={rectsPath(leds)} fill="#36d36b" />
        </>
      ),
    };
  },

  input(w, h) {
    const kb = { x: w * 0.03, y: h * 0.36, w: w * 0.7, h: h * 0.58 };
    const keys = once(`keys ${w} ${h}`, () => {
      const cols = 13;
      const rows = 4;
      const area = { x: kb.x + kb.w * 0.04, y: kb.y + kb.h * 0.1, w: kb.w * 0.92, h: kb.h * 0.6 };
      const kw = area.w / cols;
      const kh = area.h / rows;
      const all: Box[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          all.push({ x: area.x + c * kw + kw * 0.1, y: area.y + r * kh + kh * 0.12, w: kw * 0.8, h: kh * 0.76 });
        }
      }
      all.push({ x: kb.x + kb.w * 0.3, y: kb.y + kb.h * 0.74, w: kb.w * 0.4, h: kb.h * 0.14 });
      return rectsPath(all);
    });
    return {
      base: (
        <>
          <path d={`M${w * 0.32} 0V${kb.y}`} stroke={CABLE.usb.body} strokeWidth={7} strokeLinecap="round" />
          <rect {...rect(kb)} rx={h * 0.05} fill={PLASTIC} stroke={PLASTIC_EDGE} {...LINE} />
          <path d={keys} fill="#2f353f" />
          <rect x={w * 0.8} y={h * 0.4} width={w * 0.14} height={h * 0.52} rx={w * 0.07} fill={PLASTIC} stroke={PLASTIC_EDGE} {...LINE} />
          <path d={`M${w * 0.87} ${h * 0.4}V${h * 0.6}`} stroke={PLASTIC_EDGE} {...LINE} />
        </>
      ),
    };
  },

  speakers(w, h) {
    const boxes = [
      { x: w * 0.06, y: h * 0.3, w: w * 0.36, h: h * 0.66 },
      { x: w * 0.58, y: h * 0.3, w: w * 0.36, h: h * 0.66 },
    ];
    return {
      base: (
        <>
          <path d={`M${w * 0.27} 0V${h * 0.3}`} stroke={CABLE.audio.body} strokeWidth={7} strokeLinecap="round" />
          <path d={`M${w * 0.42} ${h * 0.88}H${w * 0.58}`} stroke="#2b2f36" strokeWidth={h * 0.03} />
          {boxes.map((b) => (
            <g key={b.x}>
              <rect {...rect(b)} rx={b.w * 0.08} fill={PLASTIC} stroke={PLASTIC_EDGE} {...LINE} />
              <circle cx={b.x + b.w / 2} cy={b.y + b.h * 0.66} r={b.w * 0.32} fill="#111418" stroke="#4a515b" {...LINE} />
              <circle cx={b.x + b.w / 2} cy={b.y + b.h * 0.66} r={b.w * 0.12} fill="#2b3037" />
              <circle cx={b.x + b.w / 2} cy={b.y + b.h * 0.24} r={b.w * 0.12} fill="#111418" stroke="#4a515b" {...LINE} />
            </g>
          ))}
        </>
      ),
    };
  },

  monitor(w, h) {
    return {
      base: (
        <>
          <path d={`M${w * 0.48} 0V${h * 0.06}`} stroke={CABLE.display.body} strokeWidth={7} strokeLinecap="round" />
          <rect x={w * 0.46} y={h * 0.74} width={w * 0.08} height={h * 0.16} fill="#2a2f36" />
          <rect x={w * 0.33} y={h * 0.89} width={w * 0.34} height={h * 0.06} rx={h * 0.02} fill="#2a2f36" stroke={PLASTIC_EDGE} {...LINE} />
          <rect x={w * 0.04} y={h * 0.05} width={w * 0.92} height={h * 0.72} rx={w * 0.015} fill="#0d1014" stroke={PLASTIC_EDGE} {...LINE} />
          <rect x={w * 0.06} y={h * 0.09} width={w * 0.88} height={h * 0.62} fill="url(#hw-screen)" />
          <rect x={w * 0.5} y={h * 0.18} width={w * 0.32} height={h * 0.32} rx={w * 0.006} fill="#e8edf2" fillOpacity={0.13} />
          <rect x={w * 0.5} y={h * 0.18} width={w * 0.32} height={h * 0.05} fill="#e8edf2" fillOpacity={0.12} />
          <rect x={w * 0.06} y={h * 0.65} width={w * 0.88} height={h * 0.06} fill="#000" fillOpacity={0.35} />
        </>
      ),
    };
  },

  logic(w, h, part) {
    return { base: <Logic w={w} h={h} seed={hashSeed(part.key)} /> };
  },

  sram(w, h) {
    return { base: <Cells w={w} h={h} tone="sram" /> };
  },

  regfile(w, h) {
    return { base: <Cells w={w} h={h} tone="regfile" /> };
  },

  ring(w, h) {
    const stops = rectsPath(spread({ x: 0, y: h * 0.2, w, h: h * 0.6 }, 4, h * 0.6, false));
    return {
      base: (
        <>
          <rect width={w} height={h} fill="#1d2131" stroke={DIE_EDGE} {...LINE} />
          <rect y={h * 0.3} width={w} height={h * 0.1} fill="#7d8aa8" />
          <rect y={h * 0.6} width={w} height={h * 0.1} fill="#7d8aa8" />
          <path d={stops} fill="#39425a" stroke="#9aa6c4" {...LINE} />
        </>
      ),
    };
  },

  phy(w, h, part) {
    const strip = h * 0.18;
    const bars = once(`phy ${w} ${h}`, () =>
      rectsPath(stripes({ x: 0, y: h - strip, w, h: strip }, strip * 0.32, 0.5, true)),
    );
    return {
      base: (
        <>
          <Logic w={w} h={h - strip} seed={hashSeed(part.key)} base="#262c3d" />
          <rect y={h - strip} width={w} height={strip} fill="#3a3220" />
          <path d={bars} fill="#b38f3e" />
        </>
      ),
    };
  },
};

/** A core between its units: plain silicon. */
function coreArt(w: number, h: number): Art {
  return { base: <rect width={w} height={h} fill="#1a1e2c" stroke={DIE_EDGE} {...LINE} /> };
}

/** How a part is drawn: its own look, or one that suits its kind. */
export function partArt(node: Placed): Art {
  const { part, world } = node;
  const look = lookOf(part);
  if (look === null) return {};
  if (look === "core") return coreArt(world.w, world.h);
  return DRAW[look](world.w, world.h, part);
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** A part drawn as its children's drawings, before they are fully shown. */
export function Preview({ node }: { node: Placed }) {
  return (
    <>
      {node.children.map((child) => {
        const art = partArt(child);
        if (!art.base) return null;
        return (
          <g key={child.id} transform={`translate(${round(child.world.x - node.world.x)} ${round(child.world.y - node.world.y)})`}>
            {art.base}
          </g>
        );
      })}
    </>
  );
}

// ——— Boards, decor and wires ———————————————————————————————————————————————

/** A circuit board: green solder mask over faint routing, with a few vias. */
export function BoardArt({ box }: { box: Box }) {
  const d = once(`board ${box.w} ${box.h}`, () => routing(box.w, box.h, 7, 170));
  return (
    <g transform={`translate(${box.x} ${box.y})`} pointerEvents="none">
      <rect width={box.w} height={box.h} rx={14} fill="url(#hw-pcb)" stroke="#1e4a3c" strokeWidth={1.5} {...LINE} />
      <path d={d.wires} fill="none" stroke="#1d4d3f" {...LINE} />
      <path d={d.vias} fill="#2a5e4e" />
    </g>
  );
}

/** Something on the board that is not part of the model. */
export function DecorArt({ decor, box }: { decor: Decor; box: Box }) {
  const { w, h } = box;
  return (
    <g transform={`translate(${box.x} ${box.y})`} pointerEvents="none">
      {decorArt(decor, w, h)}
    </g>
  );
}

function decorArt(decor: Decor, w: number, h: number): ReactNode {
  switch (decor.kind) {
    case "socket":
      return (
        <>
          <rect width={w} height={h} rx={w * 0.02} fill="#22262c" stroke="#4a5059" {...LINE} />
          <rect x={w * 0.02} y={h * 0.02} width={w * 0.96} height={h * 0.96} rx={w * 0.015} fill="#1a1d22" />
        </>
      );
    case "slot":
      return (
        <>
          <rect x={w * 0.06} y={h * 0.025} width={w * 0.88} height={h * 0.95} rx={w * 0.04} fill="#1b1e22" stroke="#30353c" {...LINE} />
          <rect x={w * 0.15} width={w * 0.7} height={h * 0.036} rx={w * 0.04} fill="#dcdcd8" />
          <rect x={w * 0.15} y={h * 0.964} width={w * 0.7} height={h * 0.036} rx={w * 0.04} fill="#dcdcd8" />
        </>
      );
    case "vrm": {
      const fins = once(`vrm ${w} ${h}`, () =>
        w >= h
          ? rectsPath(stripes({ x: w * 0.02, y: h * 0.1, w: w * 0.96, h: h * 0.8 }, h * 0.2, 0.5, true))
          : rectsPath(stripes({ x: w * 0.1, y: h * 0.02, w: w * 0.8, h: h * 0.96 }, w * 0.2, 0.5, false)),
      );
      return (
        <>
          <rect width={w} height={h} rx={Math.min(w, h) * 0.12} fill="#343a43" stroke="#6b737e" {...LINE} />
          <path d={fins} fill="#5d6570" />
        </>
      );
    }
    case "caps": {
      const r = Math.min(w, h) * 0.21;
      const centres = [
        [w * 0.27, h * 0.27],
        [w * 0.73, h * 0.27],
        [w * 0.27, h * 0.73],
        [w * 0.73, h * 0.73],
      ] as const;
      return (
        <>
          {centres.map(([cx, cy]) => (
            <g key={`${cx} ${cy}`}>
              <circle cx={cx} cy={cy} r={r} fill="#2b2f36" stroke="#8b929b" {...LINE} />
              <path d={`M${cx - r * 0.6} ${cy}H${cx + r * 0.6}M${cx} ${cy - r * 0.6}V${cy + r * 0.6}`} stroke="#6b727b" {...LINE} />
            </g>
          ))}
        </>
      );
    }
    case "io": {
      const count = Math.max(1, Math.floor(h / 34));
      const ports = spread({ x: w * 0.14, y: 0, w: w * 0.72, h }, count, (h / count) * 0.62, true);
      const tongues = ports.map((p) => ({ x: p.x + p.w * 0.14, y: p.y + p.h * 0.32, w: p.w * 0.72, h: p.h * 0.36 }));
      return (
        <>
          <rect width={w} height={h} rx={w * 0.1} fill="#2a2f36" stroke="#444b55" {...LINE} />
          <path d={rectsPath(ports)} fill="#15181c" />
          <path d={rectsPath(tongues)} fill="#2b6cff" />
        </>
      );
    }
    case "power": {
      const pins = once(`atx ${w} ${h}`, () => {
        const all: Box[] = [];
        for (let r = 0; r < 12; r++) {
          for (let c = 0; c < 2; c++) all.push({ x: w * (0.14 + c * 0.42), y: h * (0.03 + r * 0.08), w: w * 0.3, h: h * 0.06 });
        }
        return rectsPath(all);
      });
      return (
        <>
          <rect width={w} height={h} rx={w * 0.08} fill="#d6d6d0" stroke="#a9a9a3" {...LINE} />
          <path d={pins} fill="#6d737a" />
        </>
      );
    }
    case "battery":
      return (
        <>
          <circle cx={w / 2} cy={h / 2} r={w * 0.5} fill="#1b1e22" />
          <circle cx={w / 2} cy={h / 2} r={w * 0.42} fill="url(#hw-metal)" stroke="#7f8790" {...LINE} />
          <circle cx={w / 2} cy={h / 2} r={w * 0.34} fill="none" stroke="#a0a7af" {...LINE} />
          <Lettering text="CR2032" x={w / 2} y={h / 2 - w * 0.055} size={w * 0.11} color="#5d646c" />
        </>
      );
    case "sata":
      return (
        <>
          {[0, 1].map((i) => (
            <g key={i}>
              <rect x={i * w * 0.52} width={w * 0.48} height={h} rx={h * 0.12} fill="#1d2733" stroke="#3b4b5e" {...LINE} />
              <rect x={i * w * 0.52 + w * 0.06} y={h * 0.32} width={w * 0.36} height={h * 0.36} fill="#0b0f14" />
            </g>
          ))}
        </>
      );
    case "hole":
      return (
        <>
          <circle cx={w / 2} cy={h / 2} r={w * 0.5} fill="#b9c0c7" />
          <circle cx={w / 2} cy={h / 2} r={w * 0.24} fill="#0a0d10" />
        </>
      );
    case "silk": {
      const [first = "", ...rest] = (decor.text ?? "").split("\n");
      return (
        <g opacity={0.5}>
          <Lettering text={first} x={0} y={h * 0.08} size={h * 0.36} color="#d9e2dc" anchor="start" weight={0.14} />
          {rest.map((line, i) => (
            <Lettering key={i} text={line} x={0} y={h * (0.62 + i * 0.25)} size={h * 0.16} color="#d9e2dc" anchor="start" />
          ))}
        </g>
      );
    }
  }
}

/** The wires of a link: a bus of traces on the board, or a cable outside the case. */
export function WireArt({ points, cable }: { points: Point[]; cable?: Cable }) {
  if (cable) {
    const d = polylinePath(points);
    return (
      <>
        <path d={d} fill="none" stroke={CABLE[cable].body} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
        <path d={d} fill="none" stroke={CABLE[cable].shine} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      </>
    );
  }
  const d = bundle(points, 4, 1.8).map(polylinePath).join("");
  return <path d={d} fill="none" stroke="#5aa886" strokeOpacity={0.8} {...LINE} />;
}
