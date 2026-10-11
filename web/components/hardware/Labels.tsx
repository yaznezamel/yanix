"use client";

import { memo } from "react";
import { SIGNAL } from "@/components/lab/palette";
import type { Activity } from "@/lib/hardware/activity";
import { TREE, isVertical, labelWidth, linkShape, type Detail, type LabelFit, type Placed } from "@/lib/hardware/tree";
import type { Box, Link } from "@/lib/hardware/types";
import type { Fades } from "./fades";
import styles from "./hardware.module.css";
import { dimmed, inParent } from "./state";

// Every name in the hardware view, in one layer above the drawing. The layer
// is not inside the zoomed drawing: each name is moved to where its part is
// on screen, by CSS variables the camera sets on this layer alone (--k, the
// zoom, and --tx and --ty, the offset). Names keep their size on screen, and
// since nothing above them ever scales, the browser need not lay their text
// out again on every frame of a zoom. Which name a part shows, and at what
// size, comes from the level of detail (lib/hardware/tree.ts). Screen readers
// get the names from the parts themselves, so this layer is hidden from them.

const INK = "#e8edf2";
const MUTED = "#9aa5b1";
/** The backing behind a part's name, so it reads over any drawing. */
const TAG = "rgba(8, 11, 15, 0.76)";
const DIM = 0.45;

/** Places a group at a world point, on screen: its contents are in screen pixels. */
function screenSized(x: number, y: number, extra = ""): React.CSSProperties {
  return { transform: `translate(calc(var(--k) * ${x}px + var(--tx)), calc(var(--k) * ${y}px + var(--ty)))${extra}` };
}

export const LabelLayer = memo(function LabelLayer({
  detail,
  activity,
  active,
  fades,
}: {
  detail: Detail;
  activity: Activity;
  active: boolean;
  fades: Fades;
}) {
  // For each part showing its children: their names, its wires' names and its frames' legends,
  // fading in with the children. Parents come first, so a part's name is under its children's.
  return (
    <>
      {TREE.all
        .filter((p) => detail.open.has(p.id))
        .map((p) => (
          <g key={p.id} ref={p.depth > 0 ? fades.track(p.id, "labels") : undefined}>
            {p.part.links?.map((link) => {
              const id = `${p.id}:${link.id}`;
              return detail.linkLabels.has(id) ? (
                <LinkLabel key={link.id} parent={p} link={link} lit={activity.links.has(id)} />
              ) : null;
            })}
            {p.part.frames?.map((frame) => (
              <FrameLegend key={frame.label} box={inParent(p, frame.box)} label={frame.label} />
            ))}
            {p.children.map((child) => {
              const fit = detail.labels.get(child.id);
              if (!fit || fit.place === "none" || !detail.drawn.has(child.id)) return null;
              return (
                <PartLabel
                  key={child.id}
                  node={child}
                  fit={fit}
                  open={detail.open.has(child.id)}
                  dim={dimmed(child, activity, active)}
                />
              );
            })}
          </g>
        ))}
    </>
  );
});

function PartLabel({ node, fit, open, dim }: { node: Placed; fit: LabelFit; open: boolean; dim: boolean }) {
  const { world: w, part } = node;
  const fade = { opacity: dim ? DIM : 1 };
  if (fit.place === "none") return null;
  if (fit.place === "below") {
    return (
      <g className={styles.group} style={fade}>
        <g style={screenSized(w.x + w.w / 2, w.y + w.h)}>
          <text textAnchor="middle" fontSize={fit.size} fontWeight={600} fill={INK} className={styles.halo}>
            {fit.lines.map((line, i) => (
              <tspan key={i} x={0} y={fit.size + 3 + i * (fit.size + 2)}>
                {line}
              </tspan>
            ))}
          </text>
        </g>
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
    <g className={styles.group} style={fade}>
      <g style={style}>
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
    </g>
  );
}

/** A wire's name, beside the middle of its longest straight run. */
function LinkLabel({ parent, link, lit }: { parent: Placed; link: Link; lit: boolean }) {
  const { label } = linkShape(parent, link);
  return (
    <g style={screenSized(label.x, label.y)}>
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
  );
}

/** The frame's name on its top edge, like a legend, over any wire that runs under it. */
function FrameLegend({ box, label }: { box: Box; label: string }) {
  const text = label.toUpperCase();
  const width = text.length * 7.8 + 12;
  return (
    <g style={screenSized(box.x, box.y)}>
      <rect x={14} y={-8} width={width} height={16} rx={3} fill="#0e1217" />
      <text x={20} y={4} fontSize={10.5} letterSpacing="0.14em" fill="rgba(255,255,255,0.6)" className="font-mono">
        {text}
      </text>
    </g>
  );
}
