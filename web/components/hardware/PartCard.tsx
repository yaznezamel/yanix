"use client";

import type { Activity } from "@/lib/hardware/activity";
import type { Placed } from "@/lib/hardware/tree";
import { NODES } from "@/lib/xray/nodes";

// The card beside a part under the pointer or with keyboard focus: what the
// part is, what it has to do with the trace, and where it is on the software
// map. The view places it (lib/hardware/camera.ts, placeBeside) and moves it
// without a render, so it starts transparent until placed. Screen readers get
// the same text from the part's own label, so the card is hidden from them.

export function PartCard({
  node,
  activity,
  active,
  by,
  ref,
}: {
  node: Placed;
  activity: Activity;
  /** A trace is under way. */
  active: boolean;
  /** Shown for the pointer or for keyboard focus: the hint names the matching key or click. */
  by: "pointer" | "focus";
  ref: React.Ref<HTMLDivElement>;
}) {
  const { part } = node;
  const status = !active
    ? null
    : activity.current.has(node.id)
      ? { text: "The signal is here now", className: "text-signal" }
      : activity.touched.has(node.id)
        ? { text: "Used in this step", className: "text-signal/85" }
        : { text: "Not used in this step", className: "text-lab-muted" };
  const software = (part.maps ?? []).map((id) => NODES[id].label);
  const inside = node.children.length > 0;

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 z-10 w-max max-w-[min(300px,calc(100%-16px))] rounded-lg border border-white/15 bg-lab-bg/95 px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.55)] backdrop-blur-sm"
      style={{ opacity: 0 }}
    >
      <p className="text-[13.5px] font-semibold leading-tight text-lab-ink">{part.label}</p>
      {part.sub && <p className="mt-0.5 font-mono text-[11px] text-lab-muted">{part.sub}</p>}
      <p className="mt-1.5 text-[12.5px] leading-snug text-lab-ink/85">{part.about}</p>
      {status && <p className={`mt-1.5 text-[12px] font-medium ${status.className}`}>{status.text}</p>}
      {(software.length > 0 || part.runs) && (
        <p className="mt-1.5 text-[11.5px] leading-snug text-lab-muted">
          On the software map:{" "}
          <span className="text-lab-ink/80">
            {part.runs ? "runs the code in User space and the Kernel" : software.join(", ")}
          </span>
        </p>
      )}
      {inside && (
        <p className="mt-1.5 text-[11.5px] text-lab-muted">
          {by === "pointer" ? "Click" : "Press Enter"} to look inside
        </p>
      )}
    </div>
  );
}
