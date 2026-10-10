import { NODES } from "@/lib/xray/nodes";
import type { NodeId, Step } from "@/lib/xray/types";
import { lineage, type Placed, type Tree } from "./tree";

// Which parts and wires a step of a trace uses. Steps are written against the
// lab's software map (lib/xray/nodes.ts); a part says which map nodes it
// stands for (`maps`), and the CPU runs everything in user space and the
// kernel (`runs`). A hop between two parts lights the shortest chain of links
// between them, so a DMA from the SSD to RAM crosses the CPU's PCIe link and
// a memory channel.

export interface Activity {
  /** Parts the signal is at now, with their ancestors (a busy core makes its CPU busy). */
  current: ReadonlySet<string>;
  /** Parts the step goes through at any point, with their ancestors. */
  touched: ReadonlySet<string>;
  /** Links used so far, including the hop under way, as "parentId:linkId". */
  links: ReadonlySet<string>;
}

export const IDLE: Activity = { current: new Set(), touched: new Set(), links: new Set() };

/** The parts a lab map node stands for. */
export function partsFor(tree: Tree, node: NodeId): Placed[] {
  const layer = NODES[node].layer;
  return tree.all.filter(
    (p) =>
      p.part.maps?.includes(node) ||
      ((layer === "user" || layer === "kernel") && p.part.runs?.includes(layer)),
  );
}

/** Link ids, by breadth-first search, on a shortest route between two children of `parent`. */
export function shortestLinks(parent: Placed, from: string, to: string): string[] {
  if (from === to) return [];
  const links = parent.part.links ?? [];
  const via = new Map<string, { prev: string; link: string }>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const link of links) {
      const next = link.from === at ? link.to : link.to === at ? link.from : null;
      if (next === null || seen.has(next)) continue;
      seen.add(next);
      via.set(next, { prev: at, link: link.id });
      if (next === to) {
        const route: string[] = [];
        for (let node = to; node !== from; ) {
          const step = via.get(node)!;
          route.unshift(step.link);
          node = step.prev;
        }
        return route;
      }
      queue.push(next);
    }
  }
  return [];
}

/** The links a signal crosses between two parts, found in their closest common ancestor. */
export function linksBetween(a: Placed, b: Placed): string[] {
  const la = lineage(a);
  const lb = lineage(b);
  let i = 0;
  while (i < la.length && i < lb.length && la[i] === lb[i]) i++;
  const parent = la[i - 1];
  const childA = la[i];
  const childB = lb[i];
  // One part contains the other: the hop stays inside it.
  if (!parent || !childA || !childB) return [];
  return shortestLinks(parent, childA.part.key, childB.part.key).map((id) => `${parent.id}:${id}`);
}

/** What the hardware is doing at a point in a step: `reached` is the last path node the signal got to. */
export function activityAt(tree: Tree, step: Step | null, reached: number): Activity {
  if (!step || step.path.length === 0) return IDLE;
  const path = step.path;
  const at = Math.min(Math.max(0, reached), path.length - 1);
  const parts = new Map<NodeId, Placed[]>();
  const of = (node: NodeId) => {
    let found = parts.get(node);
    if (!found) {
      found = partsFor(tree, node);
      parts.set(node, found);
    }
    return found;
  };
  const withAncestors = (set: Set<string>, p: Placed) => {
    for (const q of lineage(p)) if (q.depth > 0) set.add(q.id);
  };

  const current = new Set<string>();
  const touched = new Set<string>();
  const links = new Set<string>();
  for (const p of of(path[at]!)) withAncestors(current, p);
  for (const node of path) for (const p of of(node)) withAncestors(touched, p);
  for (let i = 1; i <= Math.min(at + 1, path.length - 1); i++) {
    for (const a of of(path[i - 1]!)) {
      for (const b of of(path[i]!)) {
        for (const link of linksBetween(a, b)) links.add(link);
      }
    }
  }
  return { current, touched, links };
}
