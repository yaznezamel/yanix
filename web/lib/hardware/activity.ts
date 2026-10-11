import { NODES } from "@/lib/xray/nodes";
import type { NodeId, Step } from "@/lib/xray/types";
import { lineage, type Placed, type Tree } from "./tree";
import type { Link } from "./types";

// Which parts and wires a step of a trace uses. Steps are written against the
// lab's software map (lib/xray/nodes.ts); a part says which map nodes it
// stands for (`maps`), and a CPU core runs everything in user space and the
// kernel (`runs`). A hop between two parts lights the shortest chain of links
// between them and every part on the way: a DMA from the SSD to RAM crosses
// the CPU, entering at its I/O block and leaving through its memory controller.

export interface Activity {
  /** Parts the signal is at now, with their ancestors (a busy core makes its CPU busy). */
  current: ReadonlySet<string>;
  /** Parts the step goes through at any point, with their ancestors. */
  touched: ReadonlySet<string>;
  /** Links used so far, including the hop under way, as "parentId:linkId". */
  links: ReadonlySet<string>;
}

export const IDLE: Activity = { current: new Set(), touched: new Set(), links: new Set() };

/** The parts a lab map node stands for: the deepest ones, so a core rather than its CPU as well. */
export function partsFor(tree: Tree, node: NodeId): Placed[] {
  const layer = NODES[node].layer;
  const matches = tree.all.filter(
    (p) =>
      p.part.maps?.includes(node) ||
      ((layer === "user" || layer === "kernel") && p.part.runs?.includes(layer)),
  );
  return matches.filter((p) => !matches.some((q) => q !== p && q.id.startsWith(`${p.id}.`)));
}

export interface Route {
  /** The links in order. */
  links: Link[];
  /** Keys of the children the route visits, both ends included. */
  stops: string[];
}

/** A shortest route of links between two children of `parent`, found breadth first. */
export function shortestRoute(parent: Placed, from: string, to: string): Route {
  if (from === to) return { links: [], stops: [from] };
  const links = parent.part.links ?? [];
  const via = new Map<string, { prev: string; link: Link }>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const link of links) {
      const next = link.from === at ? link.to : link.to === at ? link.from : null;
      if (next === null || seen.has(next)) continue;
      seen.add(next);
      via.set(next, { prev: at, link });
      if (next === to) {
        const route: Route = { links: [], stops: [to] };
        for (let node = to; node !== from; ) {
          const step = via.get(node)!;
          route.links.unshift(step.link);
          route.stops.unshift(step.prev);
          node = step.prev;
        }
        return route;
      }
      queue.push(next);
    }
  }
  return { links: [], stops: [] };
}

/** Link ids on a shortest route between two children of `parent`. */
export function shortestLinks(parent: Placed, from: string, to: string): string[] {
  return shortestRoute(parent, from, to).links.map((l) => l.id);
}

function child(p: Placed, key: string | undefined): Placed | undefined {
  return key === undefined ? undefined : p.children.find((c) => c.part.key === key);
}

/** What a signal between two parts uses: links, and the parts it passes through on the way. */
export function hopBetween(a: Placed, b: Placed): { links: string[]; parts: Placed[] } {
  const la = lineage(a);
  const lb = lineage(b);
  let i = 0;
  while (i < la.length && i < lb.length && la[i] === lb[i]) i++;
  const parent = la[i - 1];
  const endA = la[i];
  const endB = lb[i];
  // One part contains the other: the hop stays inside it.
  if (!parent || !endA || !endB) return { links: [], parts: [] };
  const route = shortestRoute(parent, endA.part.key, endB.part.key);
  const parts: Placed[] = [];
  route.stops.forEach((key, s) => {
    const stop = child(parent, key);
    if (!stop) return;
    if (s > 0 && s < route.stops.length - 1) parts.push(stop);
    // Inside a stop: where the links arrive, and where the hop starts or ends.
    const inside = new Set<Placed>();
    for (const link of [route.links[s - 1], route.links[s]]) {
      const entered = link ? child(stop, link.enters?.[key]) : undefined;
      if (entered) inside.add(entered);
    }
    const end = s === 0 ? la[i + 1] : s === route.stops.length - 1 ? lb[i + 1] : undefined;
    if (end) inside.add(end);
    for (const p of inside) parts.push(p);
    // Two places inside one part talk through its hub, such as the CPU's interconnect.
    const hub = child(stop, stop.part.hub);
    if (hub && inside.size >= 2 && !inside.has(hub)) parts.push(hub);
  });
  return { links: route.links.map((l) => `${parent.id}:${l.id}`), parts };
}

/** The links a signal crosses between two parts, found in their closest common ancestor. */
export function linksBetween(a: Placed, b: Placed): string[] {
  return hopBetween(a, b).links;
}

/** What the hardware is doing at a point in a step: `reached` is the last path node the signal got to. */
export function activityAt(tree: Tree, step: Step | null, reached: number): Activity {
  if (!step || step.path.length === 0) return IDLE;
  const path = step.path;
  const at = Math.min(Math.max(0, reached), path.length - 1);
  const found = new Map<NodeId, Placed[]>();
  const of = (node: NodeId) => {
    let parts = found.get(node);
    if (!parts) {
      parts = partsFor(tree, node);
      found.set(node, parts);
    }
    return parts;
  };
  const withAncestors = (set: Set<string>, p: Placed) => {
    for (const q of lineage(p)) if (q.depth > 0) set.add(q.id);
  };

  const current = new Set<string>();
  const touched = new Set<string>();
  const links = new Set<string>();
  for (const p of of(path[at]!)) withAncestors(current, p);
  for (const node of path) for (const p of of(node)) withAncestors(touched, p);
  for (let i = 1; i < path.length; i++) {
    for (const a of of(path[i - 1]!)) {
      for (const b of of(path[i]!)) {
        const hop = hopBetween(a, b);
        for (const p of hop.parts) withAncestors(touched, p);
        // Wires light up as the signal gets to them: hops done, and the one under way.
        if (i <= at + 1) for (const link of hop.links) links.add(link);
      }
    }
  }
  return { current, touched, links };
}

/** How a node of the software map is found in the hardware. */
export interface Whereabouts {
  /** It is the part ("is"), its data is held in the parts ("held"), or its code runs on them ("runs"). */
  how: "is" | "held" | "runs";
  parts: Placed[];
}

/**
 * Where a node of the software map is in the hardware view: the parts it is
 * drawn as, the memory that holds it (the page cache is kept in RAM), or the
 * cores that run it (all user and kernel code, in this model on core 0).
 */
export function whereIs(tree: Tree, node: NodeId): Whereabouts {
  const layer = NODES[node].layer;
  const code = layer === "user" || layer === "kernel";
  const deepest = (ps: Placed[]) => ps.filter((p) => !ps.some((q) => q !== p && q.id.startsWith(`${p.id}.`)));
  const mapped = deepest(tree.all.filter((p) => p.part.maps?.includes(node)));
  if (mapped.length > 0) return { how: code ? "held" : "is", parts: mapped };
  if (code) return { how: "runs", parts: deepest(tree.all.filter((p) => p.part.runs?.includes(layer))) };
  return { how: "is", parts: [] };
}
