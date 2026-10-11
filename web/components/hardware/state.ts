import type { Activity } from "@/lib/hardware/activity";
import { lineage, type Placed } from "@/lib/hardware/tree";
import type { Box } from "@/lib/hardware/types";

/** How a part shows the trace: the signal is in it, it is used in this step, or it is dimmed as unused. */
export type PartState = "idle" | "current" | "touched" | "dim";

export function partState(node: Placed, activity: Activity, active: boolean): PartState {
  if (!active || node.depth === 0) return "idle";
  if (activity.current.has(node.id)) return "current";
  if (activity.touched.has(node.id)) return "touched";
  // The units of a core that runs this step's code are not unused: every
  // instruction goes through some of them. They stay as they are, unless the
  // step names them as the ones its work is about (touched, above).
  if (node.parent?.part.runs && activity.touched.has(node.parent.id)) return "idle";
  // An unused part dims if its parent is in use (or it is a top-level part);
  // inside a part that is already dimmed, it simply follows that part.
  if (node.depth === 1 || (node.parent !== null && activity.touched.has(node.parent.id))) return "dim";
  return "idle";
}

/** Is the part, or a part around it, dimmed? */
export function dimmed(node: Placed, activity: Activity, active: boolean): boolean {
  return active && lineage(node).some((p) => partState(p, activity, active) === "dim");
}

/** A box in a part's inner coordinates, in world coordinates. */
export function inParent(parent: Placed, box: Box): Box {
  return {
    x: parent.world.x + box.x * parent.unit,
    y: parent.world.y + box.y * parent.unit,
    w: box.w * parent.unit,
    h: box.h * parent.unit,
  };
}
