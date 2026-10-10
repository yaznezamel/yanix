"use client";

import { LAYER_HEX, SIGNAL, alpha } from "@/components/lab/palette";
import type { Activity } from "@/lib/hardware/activity";
import { isVertical, labelWidth, opennessCss, type Detail, type Placed } from "@/lib/hardware/tree";
import type { Frame, Link } from "@/lib/hardware/types";
import styles from "./hardware.module.css";

// How each part, wire and frame of the hardware view is drawn. Phase 1 draws
// every part as a plain box; later phases pick a drawing by the part's kind.
// Sizes are in world units, except labels: they are scaled by 1 / --zoom, so
// they stay the same size on screen, and fade in once they fit their box.

type PartState = "idle" | "current" | "touched" | "dim";

const INK = "#e8edf2";
const MUTED = "#8b96a3";

export function PartView({
  node,
  detail,
  activity,
  active,
  onDive,
  onReveal,
}: {
  node: Placed;
  detail: Detail;
  activity: Activity;
  active: boolean;
  onDive: (p: Placed) => void;
  onReveal: (p: Placed) => void;
}) {
  const open = detail.open.has(node.id);
  let state: PartState = "idle";
  if (active && node.depth > 0) {
    if (activity.current.has(node.id)) state = "current";
    else if (activity.touched.has(node.id)) state = "touched";
    // Only top-level parts dim; what is inside them follows their opacity.
    else if (node.depth === 1) state = "dim";
  }
  const reachable = node.depth === 0 || detail.interactive.has(node.id);
  const childrenReachable = node.children.some((c) => detail.interactive.has(c.id));

  return (
    <g className={styles.group} style={{ opacity: state === "dim" ? 0.35 : 1 }}>
      {node.depth > 0 && (
        <PartBox node={node} state={state} open={open} reachable={reachable} onDive={onDive} onReveal={onReveal} />
      )}
      {open && (
        <g style={{ opacity: opennessCss(node) }} pointerEvents={childrenReachable ? undefined : "none"}>
          {node.part.frames?.map((frame) => (
            <FrameOutline key={frame.label} parent={node} frame={frame} />
          ))}
          {node.part.links?.map((link) => (
            <LinkView key={link.id} parent={node} link={link} lit={activity.links.has(`${node.id}:${link.id}`)} />
          ))}
          {node.part.frames?.map((frame) => (
            <FrameLegend key={frame.label} parent={node} frame={frame} />
          ))}
          {node.children.map((child) => (
            <PartView
              key={child.id}
              node={child}
              detail={detail}
              activity={activity}
              active={active}
              onDive={onDive}
              onReveal={onReveal}
            />
          ))}
        </g>
      )}
    </g>
  );
}

/** Opacity, as CSS, that is 1 once `need` pixels fit along the box and `needAcross` across it. */
function fitsCss(along: number, need: number, across: number, needAcross: number): string {
  return `clamp(0, min(calc((var(--zoom) * ${along} - ${need}) / 12), calc((var(--zoom) * ${across} - ${needAcross}) / 6)), 1)`;
}

function PartBox({
  node,
  state,
  open,
  reachable,
  onDive,
  onReveal,
}: {
  node: Placed;
  state: PartState;
  open: boolean;
  reachable: boolean;
  onDive: (p: Placed) => void;
  onReveal: (p: Placed) => void;
}) {
  const { world: w, part } = node;
  const hex = part.kind === "network" ? LAYER_HEX.network : LAYER_HEX.hardware;
  const lit = state === "current" || state === "touched";
  const radius = Math.min(w.w, w.h) * 0.05;
  const vertical = isVertical(w);
  const along = vertical ? w.h : w.w;
  const across = vertical ? w.w : w.h;
  const label = fitsCss(along, labelWidth(part.label), across, 20);
  const short = part.short ? fitsCss(along, labelWidth(part.short), across, 20) : null;
  const subWidth = part.sub ? part.sub.length * 6 + 8 : 0;
  const sub = part.sub ? fitsCss(along, subWidth, across, 40) : null;
  const corner = vertical ? `translate(${w.x}px, ${w.y + w.h}px)` : `translate(${w.x}px, ${w.y}px)`;
  const scale = vertical ? "scale(calc(1 / var(--zoom))) rotate(-90deg)" : "scale(calc(1 / var(--zoom)))";

  return (
    <g
      role="button"
      tabIndex={reachable ? 0 : -1}
      aria-hidden={reachable ? undefined : true}
      aria-label={`${part.label}. ${part.about}`}
      data-part={node.id}
      className={styles.part}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDive(node);
        }
      }}
      onFocus={(e) => {
        if (e.currentTarget.matches(":focus-visible")) onReveal(node);
      }}
    >
      <title>{`${part.label}: ${part.about}`}</title>
      {state === "current" && (
        <rect
          className={styles.pulse}
          x={w.x}
          y={w.y}
          width={w.w}
          height={w.h}
          rx={radius}
          fill="none"
          stroke={SIGNAL}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <rect
        className={styles.box}
        x={w.x}
        y={w.y}
        width={w.w}
        height={w.h}
        rx={radius}
        fill={lit ? alpha(hex, 0.18) : alpha(hex, open ? 0.03 : 0.07)}
        stroke={state === "current" ? SIGNAL : lit ? alpha(SIGNAL, 0.55) : alpha(hex, 0.5)}
        strokeWidth={state === "current" ? 2.4 : lit ? 1.6 : 1}
        vectorEffect="non-scaling-stroke"
      />
      <g className={styles.label} style={{ transform: `${corner} ${scale}` }}>
        <text x={8} y={17} fontSize={12} fontWeight={600} fill={INK} style={{ opacity: label }}>
          {part.label}
        </text>
        {short && (
          <text
            x={8}
            y={17}
            fontSize={12}
            fontWeight={600}
            fill={INK}
            style={{ opacity: `calc(${short} * (1 - ${label}))` }}
          >
            {part.short}
          </text>
        )}
        {sub && (
          <text
            x={8}
            y={31}
            fontSize={10}
            fill={MUTED}
            className="font-mono"
            style={{ opacity: `calc(${sub} * clamp(0, 1 - 2 * ${opennessCss(node)}, 1))` }}
          >
            {part.sub}
          </text>
        )}
      </g>
    </g>
  );
}

function LinkView({ parent, link, lit }: { parent: Placed; link: Link; lit: boolean }) {
  const points = link.points.map(([x, y]) => ({
    x: parent.world.x + x * parent.unit,
    y: parent.world.y + y * parent.unit,
  }));
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  // The label sits by the middle of the longest straight run.
  let best = { length: 0, x: 0, y: 0, vertical: false };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > best.length) best = { length, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, vertical: a.x === b.x };
  }
  const textWidth = link.label.length * 6 + 8;
  const visible = best.vertical
    ? `clamp(0, calc((var(--zoom) * ${best.length} - 18) / 8), 1)`
    : `clamp(0, calc((var(--zoom) * ${best.length} - ${textWidth}) / 12), 1)`;

  return (
    <g pointerEvents="none">
      <path
        d={d}
        fill="none"
        stroke={lit ? SIGNAL : "rgba(255,255,255,0.22)"}
        strokeWidth={lit ? 2.2 : 1.4}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <g
        className={styles.label}
        style={{ transform: `translate(${best.x}px, ${best.y}px) scale(calc(1 / var(--zoom)))`, opacity: visible }}
      >
        <text
          x={best.vertical ? 6 : 0}
          y={best.vertical ? 4 : 13}
          textAnchor={best.vertical ? "start" : "middle"}
          fontSize={10}
          fill={lit ? SIGNAL : "rgba(255,255,255,0.5)"}
          className="font-mono"
        >
          {link.label}
        </text>
      </g>
    </g>
  );
}

function frameBox(parent: Placed, frame: Frame) {
  return {
    x: parent.world.x + frame.box.x * parent.unit,
    y: parent.world.y + frame.box.y * parent.unit,
    w: frame.box.w * parent.unit,
    h: frame.box.h * parent.unit,
  };
}

function FrameOutline({ parent, frame }: { parent: Placed; frame: Frame }) {
  const b = frameBox(parent, frame);
  return (
    <rect
      x={b.x}
      y={b.y}
      width={b.w}
      height={b.h}
      rx={14 * parent.unit}
      fill="rgba(255,255,255,0.015)"
      stroke="rgba(255,255,255,0.12)"
      strokeDasharray="6 6"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  );
}

/** The frame's name on its top edge, like a legend, over any wire that runs under it. */
function FrameLegend({ parent, frame }: { parent: Placed; frame: Frame }) {
  const b = frameBox(parent, frame);
  const text = frame.label.toUpperCase();
  const width = text.length * 7.8 + 12;
  return (
    <g className={styles.label} style={{ transform: `translate(${b.x}px, ${b.y}px) scale(calc(1 / var(--zoom)))` }}>
      <rect x={14} y={-8} width={width} height={16} rx={3} fill="#0e1217" />
      <text x={20} y={4} fontSize={10.5} letterSpacing="0.14em" fill="rgba(255,255,255,0.45)" className="font-mono">
        {text}
      </text>
    </g>
  );
}
