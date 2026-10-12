import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INITIAL_APPS } from "../apps";
import { INITIAL_PLAYER, currentApps, playerReducer, type PlayerState } from "../engine";
import { NODE_IDS } from "../nodes";
import type { AppState, Scenario, ScenarioRequest } from "../types";
import { ARRAY_MAP, CORES_LAYOUTS, DESCRIPTOR, STACK_MAP, arrayMapping, stackMapping } from "./layout";
import {
  CORE_COUNT,
  mainSleeps,
  mainWakes,
  parseThreads,
  placeThread,
  sliceOf,
  sumOf,
  takeStack,
  threadExits,
  type CoreUse,
  type CoresState,
} from "./program";
import { CORES_C } from "./source";

// The sums and the output were checked against the real program
// (examples/cores/test.sh); the addresses come from three real runs.

describe("the C source", () => {
  it("is examples/cores/cores.c, line for line", () => {
    const file = readFileSync(join(__dirname, "../../../../examples/cores/cores.c"), "utf8");
    expect(CORES_C.join("\n")).toBe(file.replace(/\n$/, ""));
  });
});

describe("the work", () => {
  it("adds up i % 101 as the program does", () => {
    expect(sumOf(0, 1000000)).toBe(49999950);
    expect(sumOf(0, 250000)).toBe(12499050);
    expect(sumOf(250000, 250000)).toBe(12499675);
    expect(sumOf(750000, 250000)).toBe(12500925);
    expect(sumOf(500000, 500000)).toBe(25001225);
    expect(sumOf(333333, 333333)).toBe(16666617);
  });

  it("slices the array as main() does: equal parts, the last one taking the rest", () => {
    expect([0, 1, 2].map((t) => sliceOf(t, 3))).toEqual([
      { first: 0, count: 333333 },
      { first: 333333, count: 333333 },
      { first: 666666, count: 333334 },
    ]);
    expect(sliceOf(0, 1)).toEqual({ first: 0, count: 1000000 });
  });

  it("reads the thread count as sscanf(\"%d\") and the range check do", () => {
    expect(parseThreads("4")).toBe(4);
    expect(parseThreads("  2 threads")).toBe(2);
    expect(parseThreads("0")).toBe(0);
    expect(parseThreads("abc")).toBeNull();
    expect(parseThreads("")).toBeNull();
    expect(parseThreads("9")).toBeNull();
    expect(parseThreads("-1")).toBeNull();
    // strtol saturates, then the cast to int keeps the low 32 bits: 2^32 + 1 is 1.
    expect(parseThreads("4294967297")).toBe(1);
  });
});

describe("the scheduler model", () => {
  const start: CoreUse[] = [{ running: "main", queued: null }, ...Array.from({ length: 3 }, () => ({ running: null, queued: null }))];

  it("puts new threads on idle cores, then in the run queue of main()'s core", () => {
    let cores = start;
    const placed: [number, boolean][] = [];
    for (let n = 1; n <= 4; n++) {
      const p = placeThread(cores, n);
      cores = p.cores;
      placed.push([p.core, p.queued]);
    }
    expect(placed).toEqual([[1, false], [2, false], [3, false], [0, true]]);
    // main() sleeps: thread 4 runs on its core.
    expect(mainSleeps(cores)[0]).toEqual({ running: 4, queued: null });
  });

  it("wakes main() on its last core when idle, else on an idle one", () => {
    const busy: CoreUse[] = [{ running: 4, queued: null }, { running: null, queued: null }, { running: 2, queued: null }, { running: 3, queued: null }];
    expect(mainWakes(busy, 0).core).toBe(1);
    const idle = threadExits(busy, 4);
    expect(mainWakes(idle, 0).core).toBe(0);
  });

  it("reuses the newest cached stack, as glibc does", () => {
    expect(takeStack({ stacks: 0, cache: [] })).toEqual({ stack: 0, reused: false, stacks: 1, cache: [] });
    expect(takeStack({ stacks: 2, cache: [1, 0] })).toEqual({ stack: 1, reused: true, stacks: 2, cache: [0] });
  });
});

describe("the measured layout", () => {
  it("puts the array right below the C library, and each new stack below the last", () => {
    for (const layout of CORES_LAYOUTS) {
      const array = arrayMapping(layout);
      expect(array.start + ARRAY_MAP).toBe(layout.libc);
      expect(stackMapping(layout, 0).top).toBe(array.start);
      expect(stackMapping(layout, 1).top).toBe(stackMapping(layout, 0).start);
      expect(stackMapping(layout, 0).top - stackMapping(layout, 0).start).toBe(STACK_MAP);
      expect(layout.rbp % 16).toBe(0);
    }
    // gdb, run 1: the first thread's descriptor (pthread_t) and its futex word.
    const top = stackMapping(CORES_LAYOUTS[0]!, 0).top;
    expect(top - DESCRIPTOR).toBe(0x7f812082e6c0);
  });
});

// ---------------------------------------------------------------- a session

function play(state: PlayerState, request: ScenarioRequest): PlayerState {
  return playerReducer(playerReducer(state, { type: "start", request }), { type: "finish" });
}

function coresOf(apps: AppState): CoresState {
  if (apps.program?.kind !== "cores") throw new Error("./cores is not running");
  return apps.program;
}

const withTerminal: AppState = { ...INITIAL_APPS, windows: { ...INITIAL_APPS.windows, terminal: "open" } };
const INPUT = ["4", "1", "abc", "2", "0"];
const states: PlayerState[] = [];
const scenarios: Scenario[] = [];
{
  let state: PlayerState = { ...INITIAL_PLAYER, apps: withTerminal };
  state = play(state, { kind: "runProgram", program: "cores" });
  states.push(state);
  scenarios.push(state.run!.scenario);
  for (const text of INPUT) {
    state = play(state, { kind: "programInput", text });
    states.push(state);
    scenarios.push(state.run!.scenario);
  }
}
const program = (i: number) => coresOf(currentApps(states[i]!));
const output = (i: number) => currentApps(states[i]!).terminal.lines.filter((l) => l.kind === "output").map((l) => l.text);

describe("a session with ./cores", () => {
  it("maps and fills the array, then asks for a number of threads", () => {
    const p = program(0);
    expect([p.stage, p.mapped, p.filled]).toEqual(["threads", true, true]);
    expect(p.heap.chunks.map((c) => c.tag)).toEqual(["tcache", "stdout", "stdin"]);
    expect(currentApps(states[0]!).terminal.lines.at(-1)).toEqual({ kind: "ask", text: "How many threads (1 to 4, 0 to stop)? " });
  });

  it("runs 4 threads on the 4 cores and prints what the real program prints", () => {
    const p = program(1);
    expect(p.workers.map((w) => [w.n, w.core, w.state, w.sum])).toEqual([
      [1, 1, "joined", 12499050],
      [2, 2, "joined", 12499675],
      [3, 3, "joined", 12500300],
      [4, 0, "joined", 12500925],
    ]);
    expect(output(1)).toEqual([
      "thread 1: marks 0 to 249999 add up to 12499050 (finished on CPU 1)",
      "thread 2: marks 250000 to 499999 add up to 12499675 (finished on CPU 2)",
      "thread 3: marks 500000 to 749999 add up to 12500300 (finished on CPU 3)",
      "thread 4: marks 750000 to 999999 add up to 12500925 (finished on CPU 0)",
      "average of 1000000 marks: 49.99995",
    ]);
    expect([p.stacks, p.cache]).toEqual([4, [3, 2, 1, 0]]);
    expect(p.total).toBe(49999950);
  });

  it("reuses a cached stack, and keeps main() on one core at a time", () => {
    const p = program(2);
    expect(p.stacks).toBe(4);
    expect(p.workers[0]?.stack).toBe(3);
    expect(output(2).slice(-2)).toEqual([
      `thread 1: marks 0 to 999999 add up to 49999950 (finished on CPU ${p.workers[0]?.core})`,
      "average of 1000000 marks: 49.99995",
    ]);
  });

  it("asks again after a line that is not a number from 0 to 4", () => {
    expect(program(3).stage).toBe("threads");
    expect(output(3)).toEqual(output(2));
  });

  it("hands the array back with munmap() and exits on 0", () => {
    const p = program(5);
    expect([p.stage, p.mapped]).toEqual(["exited", false]);
    expect(currentApps(states[5]!).terminal.busy).toBe(false);
  });

  it("never has a core run two things, nor main() on two cores", () => {
    for (const scenario of scenarios) {
      for (const step of scenario.steps) {
        const p = step.ui?.program;
        expect(p?.kind).toBe("cores");
        if (p?.kind !== "cores") continue;
        expect(p.cores).toHaveLength(CORE_COUNT);
        expect(p.cores.filter((c) => c.running === "main").length).toBeLessThanOrEqual(1);
        const running = p.cores.flatMap((c) => (typeof c.running === "number" ? [c.running] : []));
        expect(new Set(running).size).toBe(running.length);
        for (const core of step.cores ?? []) expect(core).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("builds well-formed traces", () => {
    for (const scenario of scenarios) {
      const ids = scenario.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const step of scenario.steps) {
        step.path.forEach((id, i) => {
          expect(NODE_IDS).toContain(id);
          if (i > 0) expect(step.path[i - 1]).not.toBe(id);
        });
        for (const f of step.frames ?? []) expect(f.at).toBeLessThan(step.path.length);
        for (const part of step.parts ?? []) expect(part).toMatch(/^cpu\.core[0-3]\.(regs|exec|l1d|tlb|l2)$/);
        expect(step.body.length).toBeGreaterThan(20);
      }
    }
  });
});

describe("both programs in one terminal", () => {
  it("switches from ./marks to ./cores, and ./cores dies with its terminal", () => {
    let state: PlayerState = { ...INITIAL_PLAYER, apps: withTerminal };
    state = play(state, { kind: "runProgram", program: "marks" });
    // While ./marks reads, "./cores" is just a name to it.
    state = play(state, { kind: "programInput", text: "./cores" });
    const marks = currentApps(state).program;
    expect(marks?.kind).toBe("marks");
    if (marks?.kind === "marks") expect(marks.names[0xab0]).toBe("./cores");
    state = play(state, { kind: "programInput", text: "50 60 70" });
    state = play(state, { kind: "programInput", text: "n" });
    expect(currentApps(state).program?.stage).toBe("exited");

    state = play(state, { kind: "runProgram", program: "cores" });
    const cores = coresOf(currentApps(state));
    expect([cores.run, cores.stage]).toEqual([0, "threads"]);

    const closed = playerReducer(play(state, { kind: "programInput", text: "2" }), { type: "closeApp", app: "terminal" });
    expect(currentApps(closed).program).toBeNull();
  });
});
