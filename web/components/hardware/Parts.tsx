"use client";

import { LAYER_HEX, SIGNAL, alpha } from "@/components/lab/palette";
import type { Activity } from "@/lib/hardware/activity";
import { isVertical, linkShape, opennessCss, type Detail, type LabelFit, type Placed } from "@/lib/hardware/tree";
import type { Frame, Link } from "@/lib/hardware/types";
import styles from "./hardware.module.css";

// How each part, wire and frame of the hardware view is drawn. Phase 1 draws
// every part as a plain box; later phases pick a drawing by the part's kind.
// Sizes are in world units, except labels: they are scaled by 1 / --zoom, so
// they stay the same size on screen. Which name a part shows, and at what
// size, comes from the level of detail (lib/hardware/tree.ts).

type PartState = "idle" | "current" | "touched" | "dim";

const INK = "#e8edf2";
const MUTED = "#9aa5b1";

/** Counter-scales a group placed at a world point, so its contents are in screen pixels. */
function screenSized(x: number, y: number, extra = ""): React.CSSProperties {
  return { transform: `translate(${x}px, ${y}px) scale(calc(1 / var(--zoom)))${extra}` };
}

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
    <g className={styles.group} style={{ opacity: state === "dim" ? 0.5 : 1 }}>
      {node.depth > 0 && (
        <PartBox
          node={node}
          state={state}
          open={open}
          fit={detail.labels.get(node.id)}
          reachable={reachable}
          onDive={onDive}
          onReveal={onReveal}
        />
      )}
      {open && (
        <g style={{ opacity: opennessCss(node) }} pointerEvents={childrenReachable ? undefined : "none"}>
          {node.part.frames?.map((frame) => (
            <FrameOutline key={frame.label} parent={node} frame={frame} />
          ))}
          {node.part.links?.map((link) => {
            const id = `${node.id}:${link.id}`;
            return (
              <LinkView
                key={link.id}
                parent={node}
                link={link}
                lit={activity.links.has(id)}
                labelled={detail.linkLabels.has(id)}
              />
            );
          })}
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

function PartBox({
  node,
  state,
  open,
  fit,
  reachable,
  onDive,
  onReveal,
}: {
  node: Placed;
  state: PartState;
  open: boolean;
  fit: LabelFit | undefined;
  reachable: boolean;
  onDive: (p: Placed) => void;
  onReveal: (p: Placed) => void;
}) {
  const { world: w, part } = node;
  const hex = part.kind === "network" ? LAYER_HEX.network : LAYER_HEX.hardware;
  const lit = state === "current" || state === "touched";
  const radius = Math.min(w.w, w.h) * 0.05;

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
      {fit && <PartLabel node={node} fit={fit} open={open} />}
    </g>
  );
}

function PartLabel({ node, fit, open }: { node: Placed; fit: LabelFit; open: boolean }) {
  const { world: w, part } = node;
  if (fit.place === "none") return null;
  if (fit.place === "below") {
    return (
      <g className={styles.label} style={screenSized(w.x + w.w / 2, w.y + w.h)}>
        <text textAnchor="middle" fontSize={fit.size} fontWeight={600} fill={INK}>
          {fit.lines.map((line, i) => (
            <tspan key={i} x={0} y={fit.size + 3 + i * (fit.size + 2)}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    );
  }
  // A tall, thin part (a RAM stick) has its name written up its length.
  const vertical = isVertical(w);
  const style = vertical ? screenSized(w.x, w.y + w.h, " rotate(-90deg)") : screenSized(w.x, w.y);
  const baseline = Math.round(fit.size * 1.15 + 3);
  return (
    <g className={styles.label} style={style}>
      <text x={8} y={baseline} fontSize={fit.size} fontWeight={600} fill={INK}>
        {fit.text}
      </text>
      {fit.sub && !open && (
        <text x={8} y={baseline + 14} fontSize={10} fill={MUTED} className="font-mono">
          {part.sub}
        </text>
      )}
    </g>
  );
}

function LinkView({
  parent,
  link,
  lit,
  labelled,
}: {
  parent: Placed;
  link: Link;
  lit: boolean;
  labelled: boolean;
}) {
  const { points, label } = linkShape(parent, link);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
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
      {labelled && (
        <g className={styles.label} style={screenSized(label.x, label.y)}>
          <text
            x={label.vertical ? 6 : 0}
            y={label.vertical ? 4 : 13}
            textAnchor={label.vertical ? "start" : "middle"}
            fontSize={10}
            fill={lit ? SIGNAL : "rgba(255,255,255,0.62)"}
            className="font-mono"
          >
            {link.label}
          </text>
        </g>
      )}
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
    <g className={styles.label} style={screenSized(b.x, b.y)}>
      <rect x={14} y={-8} width={width} height={16} rx={3} fill="#0e1217" />
      <text x={20} y={4} fontSize={10.5} letterSpacing="0.14em" fill="rgba(255,255,255,0.55)" className="font-mono">
        {text}
      </text>
    </g>
  );
}
