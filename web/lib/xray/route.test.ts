import { describe, expect, it } from "vitest";
import { APPS, COLD_MACHINE, INITIAL_APPS, MEDIA, NOTES_FILE } from "./apps";
import { INITIAL_PLAYER, playerReducer, type PlayerState } from "./engine";
import { BADGE_RADIUS, buildPath } from "./geometry";
import { NODES, NODE_IDS } from "./nodes";
import { crosses, route } from "./route";
import { buildScenario } from "./scenarios";
import type { AppState, MachineState, NodeId, Scenario, ScenarioRequest } from "./types";

// Every hop of every trace, checked against the map: a route never cuts
// through a box it does not stop at, so the numbered stops read in order.

const WARM: MachineState = {
  arpCached: true,
  dnsCached: true,
  connectionOpen: false,
  pageCache: [NOTES_FILE, MEDIA.audio.file, MEDIA.video.file, ...Object.values(APPS).map((a) => a.program)],
};

const REQUESTS: ScenarioRequest[] = [
  { kind: "launch", app: "browser" },
  { kind: "launch", app: "terminal" },
  { kind: "launch", app: "editor" },
  { kind: "launch", app: "player" },
  { kind: "search", query: "q" },
  { kind: "readFile" },
  { kind: "openFile" },
  { kind: "keystroke", app: "browser", key: "h" },
  { kind: "keystroke", app: "editor", key: "h" },
  { kind: "copy", app: "editor", text: "x" },
  { kind: "copy", app: "browser", text: "x" },
  { kind: "paste", app: "browser", source: "editor", text: "x" },
  { kind: "paste", app: "editor", source: "browser", text: "x" },
  { kind: "play", media: "audio" },
  { kind: "play", media: "video" },
  { kind: "boot" },
  { kind: "login" },
  { kind: "shutdown" },
  { kind: "restart" },
];

const withTerminal: AppState = { ...INITIAL_APPS, windows: { ...INITIAL_APPS.windows, terminal: "open" } };

function play(state: PlayerState, request: ScenarioRequest): PlayerState {
  return playerReducer(playerReducer(state, { type: "start", request }), { type: "finish" });
}

function allScenarios(): Scenario[] {
  const out: Scenario[] = [];
  for (const request of REQUESTS) {
    for (const machine of [COLD_MACHINE, WARM, { ...WARM, connectionOpen: true }]) {
      out.push(buildScenario(request, machine, INITIAL_APPS));
    }
  }
  const sessions = [
    ["marks", ["Ada", "72 85 90", "y", "Bo", "1 2 3", "n"]],
    ["cores", ["4"]],
  ] as const;
  for (const [program, lines] of sessions) {
    let state: PlayerState = { ...INITIAL_PLAYER, apps: withTerminal };
    state = play(state, { kind: "runProgram", program });
    out.push(state.run!.scenario);
    out.push(play(state, { kind: "programEof" }).run!.scenario);
    out.push(play(state, { kind: "interrupt" }).run!.scenario);
    for (const text of lines) {
      state = play(state, { kind: "programInput", text });
      out.push(state.run!.scenario);
    }
  }
  return out;
}

const pairs = new Set<string>();
for (const scenario of allScenarios()) {
  for (const step of scenario.steps) {
    for (let i = 1; i < step.path.length; i++) pairs.add(`${step.path[i - 1]}>${step.path[i]}`);
  }
}

describe("routes", () => {
  it.each([...pairs])("%s goes round every box it does not stop at", (pair) => {
    const [a, b] = pair.split(">") as [NodeId, NodeId];
    const r = route(a, b);
    const points = [r.start, ...r.via, r.end];
    const user = (id: NodeId) => NODES[id].layer === "user";
    for (const id of NODE_IDS) {
      if (id === a || id === b) continue;
      // Every way between user space and the layers below passes the system call bar.
      if (NODES[id].bar && user(a) !== user(b)) continue;
      for (let i = 1; i < points.length; i++) {
        expect(crosses(points[i - 1]!, points[i]!, NODES[id]), `${pair} crosses ${id}`).toBe(false);
      }
    }
  });

  it("goes straight when nothing is in the way", () => {
    expect(route("socket", "udp").via).toEqual([]);
    expect(route("nic", "router").via).toEqual([]);
  });

  it("goes round the box between two others in a column", () => {
    const r = route("vfs", "ext4");
    expect(r.via.length).toBeGreaterThan(0);
    // Up the gap beside the column, not along the edge of the layer.
    expect(r.via.every((p) => p.x > NODES.vfs.x + NODES.vfs.w)).toBe(true);
  });

  it("leaves the system call bar where the way down is clear", () => {
    // Straight down from above the page cache would cross the VFS box.
    const r = route("syscall", "pagecache");
    expect(r.start.y).toBe(NODES.syscall.y + NODES.syscall.h / 2);
    expect(r.start.x).toBeGreaterThan(NODES.vfs.x + NODES.vfs.w);
  });
});

describe("stops along a route", () => {
  it("numbers each stop on its box's corner, and a repeated box beside the first number", () => {
    const g = buildPath(["resolver", "root", "resolver"]);
    expect(g.badges[0]).toEqual({ x: NODES.resolver.x, y: NODES.resolver.y });
    expect(g.badges[2]!.x - g.badges[0]!.x).toBeGreaterThanOrEqual(2 * BADGE_RADIUS + 4);
  });

  it("lights the run along the system call bar between where the route meets it and where it leaves", () => {
    const g = buildPath(["glibc", "syscall", "socket"]);
    expect(g.runs).toHaveLength(1);
    const [run] = g.runs;
    expect(run!.x1).toBe(NODES.glibc.x + NODES.glibc.w / 2);
    expect(run!.x2).toBe(NODES.socket.x + NODES.socket.w / 2);
    expect(run!.from).toBeLessThan(run!.to);
    expect(g.nodeAt[1]).toBeCloseTo(run!.from);
  });
});
