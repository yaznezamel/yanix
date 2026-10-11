import { describe, expect, it } from "vitest";
import { INITIAL_APPS } from "../apps";
import { INITIAL_PLAYER, currentApps, playerReducer, type PlayerState } from "../engine";
import { NODE_IDS } from "../nodes";
import type { AppState, Scenario, ScenarioRequest } from "../types";
import { chunkSize, MIN_CHUNK, TCACHE_COUNT, topSize } from "./heap";
import { STUDENT_SIZE } from "./layout";
import { bytesOf, fitInput, userOf, type ProgramState } from "./program";

// A whole session in the lab, through the playback engine: ./marks, then the
// lines the gdb measurement typed (examples/marks/README.md), with a wrong
// line of marks in the middle. Each trace starts from where the last ended.

function play(state: PlayerState, request: ScenarioRequest): PlayerState {
  const started = playerReducer(state, { type: "start", request });
  return playerReducer(started, { type: "finish" });
}

const withTerminal: AppState = { ...INITIAL_APPS, windows: { ...INITIAL_APPS.windows, terminal: "open" } };

function session(lines: string[]): { states: PlayerState[]; scenarios: Scenario[] } {
  let state: PlayerState = { ...INITIAL_PLAYER, apps: withTerminal };
  const states: PlayerState[] = [];
  const scenarios: Scenario[] = [];
  state = play(state, { kind: "runProgram" });
  states.push(state);
  scenarios.push(state.run!.scenario);
  for (const text of lines) {
    state = play(state, { kind: "programInput", text });
    states.push(state);
    scenarios.push(state.run!.scenario);
  }
  return { states, scenarios };
}

const INPUT = ["Yazn", "72 85 90", "y", "Sam", "60 70 80", "y", "Lee", "50 abc", "50 60 70", "n"];
const { states, scenarios } = session(INPUT);
const program = (i: number) => currentApps(states[i]!).program!;
const terminal = (i: number) => currentApps(states[i]!).terminal;
const lastLine = (i: number) => terminal(i).lines.at(-1);
const layout = (i: number) => program(i).heap.chunks.map((c) => `${c.at.toString(16)}:${c.size.toString(16)}`);

describe("a session with ./marks", () => {
  it("starts with three chunks on one page of a 132 KiB heap, waiting for a name", () => {
    expect(program(0).stage).toBe("name");
    expect(layout(0)).toEqual(["0:290", "290:410", "6a0:410"]);
    expect(program(0).heap.size).toBe(0x21000);
    expect(program(0).pages).toEqual([0]);
    expect(lastLine(0)).toEqual({ kind: "ask", text: "Student name: " });
    expect(terminal(0).busy).toBe(false);
  });

  it("copies the name to the heap and asks for marks", () => {
    expect(program(1).stage).toBe("marks");
    expect(program(1).s.name).toBe(userOf(0xab0));
    expect(program(1).names[0xab0]).toBe("Yazn");
    expect(program(1).callee).toEqual({ fn: "read_marks", i: null });
    expect(lastLine(1)).toEqual({ kind: "ask", text: "Marks for Yazn (3 numbers, 0 to 100): " });
    // The name you typed stays on the line of the prompt it answered.
    expect(terminal(1).lines.at(-2)).toEqual({ kind: "ask", text: "Student name: ", answer: "Yazn" });
  });

  it("stores the first student in a new array", () => {
    const p = program(2);
    expect(p.stage).toBe("again");
    expect([p.count, p.got, p.callee]).toEqual([1, 1, null]);
    expect(p.students).toBe(userOf(0xad0));
    expect(p.list).toEqual([{ name: userOf(0xab0), marks: [72, 85, 90] }]);
  });

  it("moves the array when a name blocks it, and reuses its old chunk for the next name", () => {
    expect(program(5).students).toBe(userOf(0xb10));
    expect(program(5).heap.tcache[0x20]).toEqual([0xad0]);
    expect(program(7).s.name).toBe(userOf(0xad0));
    expect(program(7).heap.tcache[0x20]).toEqual([]);
  });

  it("asks again after a bad line, keeping what sscanf() stored", () => {
    const p = program(8);
    expect(p.stage).toBe("marks");
    expect(p.got).toBe(0);
    // s is reused: Sam's last two marks are still there.
    expect(p.s.marks).toEqual([50, 70, 80]);
    expect(lastLine(8)).toEqual({ kind: "ask", text: "Please type 3 whole numbers from 0 to 100: " });
  });

  it("grows the array in place when the top chunk follows it", () => {
    expect(program(9).students).toBe(userOf(0xb10));
    expect(layout(9)).toEqual(["0:290", "290:410", "6a0:410", "ab0:20", "ad0:20", "af0:20", "b10:50"]);
  });

  it("prints what the real program printed, frees everything into the tcache and exits", () => {
    const p = program(10);
    expect(p.stage).toBe("exited");
    const rows = terminal(10).lines.filter((l) => l.kind === "output").map((l) => l.text);
    expect(rows).toEqual([
      "Yazn          72  85  90   average  82.3",
      "Sam           60  70  80   average  70.0",
      "Lee           50  60  70   average  60.0",
    ]);
    expect(p.heap.tcache[0x20]?.length).toBe(3);
    expect(p.heap.tcache[0x50]?.length).toBe(1);
    expect(terminal(10).busy).toBe(false);
  });

  it("builds well-formed traces", () => {
    for (const scenario of scenarios) {
      const ids = scenario.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const step of scenario.steps) {
        expect(step.ui?.program).toBeDefined();
        step.path.forEach((id, i) => {
          expect(NODE_IDS).toContain(id);
          if (i > 0) expect(step.path[i - 1]).not.toBe(id);
        });
        for (const f of step.frames ?? []) expect(f.at).toBeLessThan(step.path.length);
        for (const part of step.parts ?? []) expect(part).toMatch(/^cpu\.core0\.(regs|exec|l1d|tlb)$/);
      }
    }
  });

  it("gives the next run other addresses, and a fresh heap", () => {
    const again = play(states.at(-1)!, { kind: "runProgram" });
    const p = currentApps(again).program!;
    expect(p.run).toBe(1);
    expect(p.stage).toBe("name");
    expect(p.list).toEqual([]);
  });

  it("dies with its terminal", () => {
    const closed = playerReducer(states[1]!, { type: "closeApp", app: "terminal" });
    expect(currentApps(closed).program).toBeNull();
  });
});

// A small seeded generator, so a failing session can be replayed.
function random(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

function checkHeap(p: ProgramState): void {
  let end = 0;
  for (const chunk of p.heap.chunks) {
    // Chunks follow each other with no gaps, from the start of the heap.
    expect(chunk.at).toBe(end);
    expect(chunk.size % 16).toBe(0);
    expect(chunk.size).toBeGreaterThanOrEqual(MIN_CHUNK);
    end = chunk.at + chunk.size;
  }
  expect(p.heap.top).toBe(end);
  expect(topSize(p.heap)).toBeGreaterThanOrEqual(MIN_CHUNK);
  for (const [size, list] of Object.entries(p.heap.tcache)) {
    expect(list.length).toBeLessThanOrEqual(TCACHE_COUNT);
    for (const at of list) expect(p.heap.chunks.find((c) => c.at === at)).toMatchObject({ size: Number(size), state: "tcache" });
  }
  // Every chunk header written so far is on a page with RAM behind it.
  for (const chunk of p.heap.chunks) expect(p.pages).toContain(Math.floor((chunk.at + 8) / 0x1000));
  if (p.students !== 0 && p.stage !== "exited") {
    const array = p.heap.chunks.find((c) => userOf(c.at) === p.students)!;
    expect(array.state).toBe("used");
    expect(array.size).toBeGreaterThanOrEqual(chunkSize(p.count * STUDENT_SIZE));
    for (const st of p.list) {
      const name = p.heap.chunks.find((c) => userOf(c.at) === st.name)!;
      expect(name.state).toBe("used");
      expect(name.size).toBeGreaterThanOrEqual(chunkSize(bytesOf(p.names[name.at]!).length + 1));
    }
  }
}

describe("long sessions", () => {
  it.each([1, 2, 3, 4, 5])("keep the heap consistent (seed %i)", (seed) => {
    const next = random(seed);
    const pick = <T,>(items: T[]) => items[Math.floor(next() * items.length)]!;
    const letters = "abcdefghijklmnopqrstuvwxyz ÄéøЖ漢";
    let state: PlayerState = { ...INITIAL_PLAYER, apps: withTerminal };
    state = play(state, { kind: "runProgram" });
    const students = 10 + Math.floor(next() * 40);
    let lines = 0;
    for (let n = 0; n < students; n++) {
      const length = Math.floor(next() * 70);
      const name = fitInput(Array.from({ length }, () => pick([...letters])).join(""));
      state = play(state, { kind: "programInput", text: name });
      while (next() < 0.3) {
        state = play(state, { kind: "programInput", text: pick(["", "abc", "101 1 1", "-1 2 3", "1 2", "12.5 1 1"]) });
      }
      state = play(state, { kind: "programInput", text: `${Math.floor(next() * 101)} ${Math.floor(next() * 101)} 7` });
      const p = currentApps(state).program!;
      expect(p.count).toBe(n + 1);
      checkHeap(p);
      state = play(state, { kind: "programInput", text: n === students - 1 ? "n" : pick(["y", "Y", "yes"]) });
      lines++;
    }
    const end = currentApps(state).program!;
    expect(end.stage).toBe("exited");
    checkHeap(end);
    const rows = currentApps(state).terminal.lines.filter((l) => l.kind === "output");
    expect(rows).toHaveLength(lines);
  });
});
