"use client";

import { memo } from "react";
import { SIGNAL, alpha } from "@/components/lab/palette";
import type { Activity } from "@/lib/hardware/activity";
import {
  isVertical,
  labelWidth,
  linkShape,
  opennessCss,
  type Detail,
  type LabelFit,
  type Placed,
} from "@/lib/hardware/tree";
import type { Box, Frame, Link } from "@/lib/hardware/types";
import { BoardArt, DecorArt, Preview, WireArt, partArt } from "./art";
import styles from "./hardware.module.css";

// How each part, wire and frame of the hardware view is drawn: the drawing of
// the hardware (art.tsx), and over it an outline that lights up with the
// trace, and the part's name. Sizes are in world units, except names: they are
// scaled by 1 / --zoom, so they stay the same size on screen. Which name a
// part shows, and at what size, comes from the level of detail
// (lib/hardware/tree.ts).

type PartState = "idle" | "current" | "touched" | "dim";

const INK = "#e8edf2";
const MUTED = "#9aa5b1";
/** The backing behind a part's name, so it reads over any drawing. */
const TAG = "rgba(8, 11, 15, 0.76)";

/** Counter-scales a group placed at a world point, so its contents are in screen pixels. */
function screenSized(x: number, y: number, extra = ""): React.CSSProperties {
  return { transform: `translate(${x}px, ${y}px) scale(calc(1 / var(--zoom)))${extra}` };
}

/** A box in a part's inner coordinates, in world coordinates. */
function inParent(parent: Placed, box: Box): Box {
  return {
    x: parent.world.x + box.x * parent.unit,
    y: parent.world.y + box.y * parent.unit,
    w: box.w * parent.unit,
    h: box.h * parent.unit,
  };
}

interface PartViewProps {
  node: Placed;
  detail: Detail;
  activity: Activity;
  active: boolean;
  /** The one part in the tab order; arrow keys move between parts. */
  tabStop: string;
  onDive: (p: Placed) => void;
  onReveal: (p: Placed) => void;
  onArrow: (p: Placed, key: string) => boolean;
}

/** Does the part, or a part inside it, have this id? */
function holds(node: Placed, id: string): boolean {
  return node.depth === 0 || id === node.id || id.startsWith(`${node.id}.`);
}

// For each activity, a signature of how each part and the parts inside it are lit.
const activityKeys = new WeakMap<Activity, Map<string, string>>();

function activityKey(activity: Activity, node: Placed): string {
  let keys = activityKeys.get(activity);
  if (!keys) {
    keys = new Map();
    activityKeys.set(activity, keys);
  }
  const known = keys.get(node.id);
  if (known !== undefined) return known;
  const own = activity.current.has(node.id) ? "c" : activity.touched.has(node.id) ? "t" : "-";
  // A part's parent being in use decides whether an unused part dims.
  const parent = node.parent && activity.touched.has(node.parent.id) ? "^" : "";
  const links = (node.part.links ?? [])
    .filter((l) => activity.links.has(`${node.id}:${l.id}`))
    .map((l) => l.id)
    .join(",");
  const key = `${own}${parent}${links}(${node.children.map((c) => activityKey(activity, c)).join("")})`;
  keys.set(node.id, key);
  return key;
}

// A part is drawn again only when something about it, or a part inside it,
// changed: zooming changes a few names at a time, not the whole drawing.
function samePart(a: PartViewProps, b: PartViewProps): boolean {
  if (a.node !== b.node || a.active !== b.active) return false;
  if (a.onDive !== b.onDive || a.onReveal !== b.onReveal || a.onArrow !== b.onArrow) return false;
  const id = a.node.id;
  if (a.detail !== b.detail && a.detail.keys.get(id) !== b.detail.keys.get(id)) return false;
  if (a.activity !== b.activity && activityKey(a.activity, a.node) !== activityKey(b.activity, b.node)) return false;
  if (a.tabStop !== b.tabStop && (holds(a.node, a.tabStop) || holds(a.node, b.tabStop))) return false;
  return true;
}

export const PartView = memo(function PartView({
  node,
  detail,
  activity,
  active,
  tabStop,
  onDive,
  onReveal,
  onArrow,
}: PartViewProps) {
  const open = detail.open.has(node.id);
  let state: PartState = "idle";
  if (active && node.depth > 0) {
    if (activity.current.has(node.id)) state = "current";
    else if (activity.touched.has(node.id)) state = "touched";
    // An unused part dims if its parent is in use (or it is a top-level part);
    // inside a part that is already dimmed, it simply follows its opacity.
    else if (node.depth === 1 || (node.parent !== null && activity.touched.has(node.parent.id))) state = "dim";
  }
  const reachable = node.depth === 0 || detail.interactive.has(node.id);
  const childrenReachable = node.children.some((c) => detail.interactive.has(c.id));

  return (
    <g className={styles.group} style={{ opacity: state === "dim" ? 0.45 : 1 }}>
      {node.depth > 0 && (
        <PartBox
          node={node}
          state={state}
          open={open}
          full={detail.full.has(node.id)}
          drawn={detail.drawn.has(node.id)}
          fit={detail.labels.get(node.id)}
          reachable={reachable}
          tabbable={reachable && node.id === tabStop}
          onDive={onDive}
          onReveal={onReveal}
          onArrow={onArrow}
        />
      )}
      {open && (
        <g
          style={node.depth === 0 ? undefined : { opacity: opennessCss(node) }}
          pointerEvents={childrenReachable ? undefined : "none"}
        >
          {node.part.frames?.map((frame) =>
            frame.kind === "board" ? (
              <BoardArt key={frame.label} box={inParent(node, frame.box)} />
            ) : (
              <FrameOutline key={frame.label} box={inParent(node, frame.box)} unit={node.unit} />
            ),
          )}
          {node.part.decor?.map((decor, i) => (
            <DecorArt key={i} decor={decor} box={inParent(node, decor.box)} />
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
            <FrameLegend key={frame.label} box={inParent(node, frame.box)} label={frame.label} />
          ))}
          {node.children.map((child) => (
            <PartView
              key={child.id}
              node={child}
              detail={detail}
              activity={activity}
              active={active}
              tabStop={tabStop}
              onDive={onDive}
              onReveal={onReveal}
              onArrow={onArrow}
            />
          ))}
        </g>
      )}
    </g>
  );
}, samePart);

function PartBox({
  node,
  state,
  open,
  full,
  drawn,
  fit,
  reachable,
  tabbable,
  onDive,
  onReveal,
  onArrow,
}: {
  node: Placed;
  state: PartState;
  open: boolean;
  full: boolean;
  /** On screen or near it; otherwise only the outline is drawn, for keyboard focus. */
  drawn: boolean;
  fit: LabelFit | undefined;
  reachable: boolean;
  tabbable: boolean;
  onDive: (p: Placed) => void;
  onReveal: (p: Placed) => void;
  onArrow: (p: Placed, key: string) => boolean;
}) {
  const { world: w, part } = node;
  const lit = state === "current" || state === "touched";
  const radius = Math.min(w.w, w.h) * 0.03;
  const art = drawn ? partArt(node) : null;
  const box = { x: w.x, y: w.y, width: w.w, height: w.h, rx: radius };

  return (
    <g
      role="button"
      tabIndex={tabbable ? 0 : -1}
      aria-hidden={reachable ? undefined : true}
      aria-label={`${part.label}. ${part.about}`}
      data-part={node.id}
      className={styles.part}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDive(node);
        } else if (e.key.startsWith("Arrow") && onArrow(node, e.key)) {
          e.preventDefault();
        }
      }}
      onFocus={(e) => {
        if (e.currentTarget.matches(":focus-visible")) onReveal(node);
      }}
    >
      {art && (
        <g transform={`translate(${w.x} ${w.y})`}>
          {art.base}
          {open && art.open}
          {/* What hides the children: a lid fades out as they fade in; a preview of them stays until they are fully shown. */}
          {!full &&
            (art.cover ? (
              <g style={open ? { opacity: `calc(1 - ${opennessCss(node)})` } : undefined}>{art.cover}</g>
            ) : node.children.length > 0 ? (
              <Preview node={node} />
            ) : null)}
        </g>
      )}
      {state === "current" && (
        <rect
          className={styles.pulse}
          {...box}
          fill="none"
          stroke={SIGNAL}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <rect
        className={`${styles.box} ${lit ? "" : styles.idle}`}
        {...box}
        fill={state === "current" ? alpha(SIGNAL, 0.16) : lit ? alpha(SIGNAL, 0.08) : "rgba(0,0,0,0)"}
        stroke={state === "current" ? SIGNAL : lit ? alpha(SIGNAL, 0.6) : "rgba(255,255,255,0.12)"}
        strokeWidth={state === "current" ? 2.4 : lit ? 1.6 : 1}
        vectorEffect="non-scaling-stroke"
      />
      {/* Flashed by "Show in Hardware", to point out the part. */}
      <rect
        data-spot
        className={styles.spot}
        {...box}
        fill="none"
        stroke="#ffffff"
        strokeWidth={3}
        opacity={0}
        vectorEffect="non-scaling-stroke"
      />
      {drawn && fit && <PartLabel node={node} fit={fit} open={open} />}
    </g>
  );
}

function PartLabel({ node, fit, open }: { node: Placed; fit: LabelFit; open: boolean }) {
  const { world: w, part } = node;
  if (fit.place === "none") return null;
  if (fit.place === "below") {
    return (
      <g className={styles.label} style={screenSized(w.x + w.w / 2, w.y + w.h)}>
        <text textAnchor="middle" fontSize={fit.size} fontWeight={600} fill={INK} className={styles.halo}>
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
  const sub = fit.sub && !open ? part.sub : undefined;
  const width = Math.max(labelWidth(fit.text, fit.size), sub ? sub.length * 6.1 + 8 : 0) + 1;
  const bottom = sub ? baseline + 18 : baseline + Math.round(fit.size * 0.3) + 3;
  return (
    <g className={styles.label} style={style}>
      <rect x={3} y={3} width={width} height={bottom - 3} rx={3} fill={TAG} />
      <text x={8} y={baseline} fontSize={fit.size} fontWeight={600} fill={INK}>
        {fit.text}
      </text>
      {sub && (
        <text x={8} y={baseline + 14} fontSize={10} fill={MUTED} className="font-mono">
          {sub}
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
      <WireArt points={points} cable={link.cable} />
      {lit && (
        <>
          <path
            d={d}
            fill="none"
            stroke={SIGNAL}
            strokeOpacity={0.25}
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path d={d} fill="none" stroke={SIGNAL} strokeWidth={2.2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </>
      )}
      {labelled && (
        <g className={styles.label} style={screenSized(label.x, label.y)}>
          <text
            x={label.vertical ? (label.left ? -7 : 7) : 0}
            y={label.vertical ? 4 : 14}
            textAnchor={label.vertical ? (label.left ? "end" : "start") : "middle"}
            fontSize={10}
            fill={lit ? SIGNAL : "rgba(232,237,242,0.78)"}
            className={`font-mono ${styles.halo}`}
          >
            {link.label}
          </text>
        </g>
      )}
    </g>
  );
}

/** The space around the computer: a dashed outline, since it is not a thing you could hold. */
function FrameOutline({ box, unit }: { box: Box; unit: number }) {
  return (
    <rect
      x={box.x}
      y={box.y}
      width={box.w}
      height={box.h}
      rx={14 * unit}
      fill="rgba(255,255,255,0.015)"
      stroke="rgba(255,255,255,0.12)"
      strokeDasharray="6 6"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  );
}

/** The frame's name on its top edge, like a legend, over any wire that runs under it. */
function FrameLegend({ box, label }: { box: Box; label: Frame["label"] }) {
  const text = label.toUpperCase();
  const width = text.length * 7.8 + 12;
  return (
    <g className={styles.label} style={screenSized(box.x, box.y)}>
      <rect x={14} y={-8} width={width} height={16} rx={3} fill="#0e1217" />
      <text x={20} y={4} fontSize={10.5} letterSpacing="0.14em" fill="rgba(255,255,255,0.6)" className="font-mono">
        {text}
      </text>
    </g>
  );
}
