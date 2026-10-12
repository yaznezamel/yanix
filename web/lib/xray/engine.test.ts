import { describe, expect, it } from "vitest";
import {
  INITIAL_PLAYER,
  appsAt,
  fieldLocked,
  currentApps,
  currentStep,
  machineAt,
  playerReducer,
  remapIndex,
  readMs,
  stepMs,
  travelMs,
  visibleSteps,
  type PlayerAction,
  type PlayerState,
} from "./engine";
import { APPS, COLD_MACHINE, INITIAL_APPS, NOTES_FILE } from "./apps";
import { buildScenario } from "./scenarios";
import { EOT } from "./shell";
import type { Step } from "./types";

function run(actions: PlayerAction[], from: PlayerState = INITIAL_PLAYER): PlayerState {
  return actions.reduce(playerReducer, from);
}

const search: PlayerAction = { type: "start", request: { kind: "search", query: "how does dns work" } };

describe("playerReducer", () => {
  it("starts a scenario at the first step and plays it", () => {
    const state = run([search]);
    expect(state.run?.index).toBe(0);
    expect(state.run?.status).toBe("playing");
    expect(currentStep(state)?.id).toBe("key");
  });

  it("applies the trigger immediately: the omnibox shows the search URL", () => {
    const apps = currentApps(run([search]));
    expect(apps.browser.url).toBe("https://www.example.com/search?q=how%20does%20dns%20work");
    expect(apps.browser.loading).toBe(true);
  });

  it("advances on tick and finishes after the last step", () => {
    let state = run([search]);
    const total = visibleSteps(state.run!.scenario, state.detail).length;
    for (let i = 0; i < total - 1; i++) state = playerReducer(state, { type: "tick" });
    expect(state.run?.index).toBe(total - 1);
    expect(state.run?.status).toBe("playing");
    state = playerReducer(state, { type: "tick" });
    expect(state.run?.status).toBe("done");
    expect(state.run?.index).toBe(total - 1);
  });

  it("ignores ticks while paused", () => {
    const state = run([search, { type: "pause" }, { type: "tick" }, { type: "tick" }]);
    expect(state.run?.index).toBe(0);
  });

  it("keeps prev and seek in bounds", () => {
    const state = run([search, { type: "prev" }, { type: "seek", index: 999 }]);
    const total = visibleSteps(state.run!.scenario, state.detail).length;
    expect(state.run?.index).toBe(total - 1);
    expect(run([search, { type: "seek", index: -5 }]).run?.index).toBe(0);
  });

  it("reopens a finished run when the timeline is dragged into its last step", () => {
    const end = run([search, { type: "finish" }]);
    const last = end.run!.index;
    expect(playerReducer(end, { type: "seek", index: last }).run?.status).toBe("done");
    expect(playerReducer(end, { type: "seek", index: last, partial: true }).run?.status).toBe("paused");
    const playing = run([search]);
    expect(playerReducer(playing, { type: "seek", index: 2, partial: true }).run?.status).toBe("playing");
  });

  it("rewinds the apps when you step back", () => {
    const end = run([search, { type: "finish" }]);
    expect(currentApps(end).browser.page).toBe("results");
    const back = playerReducer(end, { type: "seek", index: 1 });
    expect(currentApps(back).browser.page).toBe("newtab");
    expect(currentApps(back).browser.secure).toBe(false);
  });

  it("restarts from the top when play is pressed after the end", () => {
    const state = run([search, { type: "finish" }, { type: "play" }]);
    expect(state.run?.index).toBe(0);
    expect(state.run?.status).toBe("playing");
    expect(state.run?.replay).toBe(1);
  });

  it("warms the caches, so a second search reuses the connection", () => {
    const first = run([search, { type: "finish" }]);
    expect(first.machine).toEqual({
      arpCached: true,
      dnsCached: true,
      connectionOpen: true,
      pageCache: [],
    });
    const second = playerReducer(first, search);
    const phases = new Set(second.run!.scenario.steps.map((s) => s.phase));
    expect(phases.has("dns")).toBe(false);
    expect(phases.has("tcp")).toBe(false);
    expect(phases.has("tls")).toBe(false);
    expect(currentApps(second).browser.page).toBe("results");
  });

  it("commits the previous run when a new one starts", () => {
    const state = run([search, { type: "start", request: { kind: "launch", app: "terminal" } }]);
    expect(state.apps.browser.page).toBe("results");
    expect(currentApps(state).browser.page).toBe("results");
  });

  it("drops the connection when the browser closes", () => {
    const state = run([search, { type: "finish" }, { type: "closeApp", app: "browser" }]);
    expect(state.run).toBeNull();
    expect(state.machine.connectionOpen).toBe(false);
    expect(state.machine.dnsCached).toBe(true);
    expect(currentApps(state).browser.page).toBe("newtab");
  });

  it("clears every cache", () => {
    const state = run([search, { type: "finish" }, { type: "clearCaches" }]);
    expect(state.machine).toEqual(COLD_MACHINE);
  });

  it("prints terminal output only when cat's write() step is reached", () => {
    const cat = run([{ type: "start", request: { kind: "readFile" } }]);
    const writeIndex = visibleSteps(cat.run!.scenario, cat.detail).findIndex((s) => s.id === "write");
    const before = playerReducer(cat, { type: "seek", index: writeIndex - 1 });
    const at = playerReducer(cat, { type: "seek", index: writeIndex });
    expect(currentApps(before).terminal.lines.some((l) => l.kind === "output")).toBe(false);
    expect(currentApps(at).terminal.lines.some((l) => l.kind === "output")).toBe(true);
    expect(currentApps(before).terminal.busy).toBe(true);
    expect(currentApps(run([{ type: "finish" }], at)).terminal.busy).toBe(false);
  });

  it("keeps the position when switching detail level", () => {
    let state = run([search]);
    const overview = visibleSteps(state.run!.scenario, "overview");
    const target = overview.findIndex((s) => s.id === "tcp-nat");
    state = playerReducer(state, { type: "seek", index: target });
    state = playerReducer(state, { type: "detail", detail: "deep" });
    expect(currentStep(state)?.id).toBe("tcp-nat");
    state = playerReducer(state, { type: "detail", detail: "overview" });
    expect(currentStep(state)?.id).toBe("tcp-nat");
  });
});

describe("machineAt", () => {
  it("warms each cache at the step that fills it, not when the run starts", () => {
    const state = run([search]);
    const steps = visibleSteps(state.run!.scenario, state.detail);
    const at = (id: string) => machineAt(playerReducer(state, { type: "seek", index: steps.findIndex((s) => s.id === id) }));
    expect(machineAt(state).arpCached).toBe(false);
    expect(at("arp-request").arpCached).toBe(false);
    expect(at("arp-reply").arpCached).toBe(true);
    expect(at("arp-reply").dnsCached).toBe(false);
    expect(at("resolver-answer").dnsCached).toBe(true);
    expect(at("tls-hello").connectionOpen).toBe(false);
    expect(at("tls-verify").connectionOpen).toBe(true);
    expect(machineAt(playerReducer(state, { type: "finish" }))).toEqual(state.machine);
  });
});

describe("remapIndex", () => {
  it("falls back to the nearest earlier step when the current one is hidden", () => {
    const scenario = buildScenario({ kind: "search", query: "q" }, COLD_MACHINE, INITIAL_APPS);
    const deep = visibleSteps(scenario, "deep");
    const hidden = deep.findIndex((s) => s.id === "dns-udp");
    const mapped = remapIndex(scenario, "deep", "overview", hidden);
    const overview = visibleSteps(scenario, "overview");
    const mappedStep = overview[mapped]!;
    expect(scenario.steps.indexOf(mappedStep)).toBeLessThan(scenario.steps.indexOf(deep[hidden]!));
  });
});

describe("appsAt", () => {
  it("counts the effects of steps hidden at the current detail level", () => {
    const state = run([search, { type: "detail", detail: "deep" }]);
    const last = visibleSteps(state.run!.scenario, "deep").length - 1;
    const end = playerReducer(state, { type: "seek", index: last });
    expect(appsAt(end.run!, "deep").browser.secure).toBe(true);
  });
});

describe("timing", () => {
  it("gives longer paths more travel time and scales with speed", () => {
    const scenario = buildScenario({ kind: "search", query: "q" }, COLD_MACHINE, INITIAL_APPS);
    const long = scenario.steps.find((s) => s.path.length > 6)!;
    const single = scenario.steps.find((s) => s.path.length === 1)!;
    expect(travelMs(single, 1)).toBe(0);
    expect(travelMs(long, 1)).toBeGreaterThan(1000);
    expect(stepMs(long, 2)).toBeCloseTo(stepMs(long, 1) / 2);
  });

  it("leaves time to read a step at 1x: about 240 words a minute", () => {
    const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    const step = (body: string): Step => ({ id: "s", phase: "file", path: ["vfs"], title: "Title", body });
    // 51 words with the title: a little over 12 seconds.
    expect(readMs(step(words(50)), 1)).toBe(1200 + 51 * 250);
    expect(readMs(step("Short."), 1)).toBe(3500);
    expect(readMs(step(words(200)), 1)).toBe(22000);
    // An AWS note adds its words.
    const noted: Step = { ...step(words(20)), aws: { service: "Amazon SQS", text: words(10) } };
    expect(readMs(noted, 1)).toBe(1200 + 31 * 250);
  });
});

describe("windows", () => {
  const launch: PlayerAction = { type: "start", request: { kind: "launch", app: "editor" } };

  it("opens the window only when the app draws its first frame", () => {
    const state = run([launch]);
    expect(currentApps(state).windows.editor).toBe("starting");
    const steps = visibleSteps(state.run!.scenario, state.detail);
    const draw = steps.findIndex((s) => s.id === "draw");
    expect(currentApps(playerReducer(state, { type: "seek", index: draw - 1 })).windows.editor).toBe("starting");
    expect(currentApps(playerReducer(state, { type: "seek", index: draw })).windows.editor).toBe("open");
  });

  it("does not launch an app twice", () => {
    const once = run([launch, { type: "finish" }]);
    expect(playerReducer(once, launch)).toBe(once);
  });

  it("forgets the clipboard when the app that owns it closes", () => {
    const copied = run([
      launch,
      { type: "finish" },
      { type: "start", request: { kind: "copy", app: "editor", text: "hello" } },
      { type: "finish" },
    ]);
    expect(currentApps(copied).clipboard).toEqual({ owner: "editor", text: "hello" });
    const closed = playerReducer(copied, { type: "closeApp", app: "editor" });
    expect(currentApps(closed).clipboard).toBeNull();
    expect(currentApps(closed).windows.editor).toBe("closed");
  });
});

describe("clipboard", () => {
  it("records the owner at set_selection, not when you press Ctrl+C", () => {
    const state = run([{ type: "start", request: { kind: "copy", app: "editor", text: "abc" } }]);
    const steps = visibleSteps(state.run!.scenario, state.detail);
    const owner = steps.findIndex((s) => s.id === "owner");
    expect(currentApps(playerReducer(state, { type: "seek", index: owner - 1 })).clipboard).toBeNull();
    expect(currentApps(playerReducer(state, { type: "seek", index: owner })).clipboard?.text).toBe("abc");
  });

  it("pastes into the search box when the text reaches the screen", () => {
    const start = run([{ type: "draft", text: "linux " }, { type: "start", request: { kind: "paste", app: "browser", source: "editor", text: "page cache" } }]);
    const steps = visibleSteps(start.run!.scenario, start.detail);
    const show = steps.findIndex((s) => s.id === "show");
    expect(currentApps(playerReducer(start, { type: "seek", index: show - 1 })).browser.draft).toBe("linux ");
    expect(currentApps(playerReducer(start, { type: "seek", index: show })).browser.draft).toBe("linux page cache");
  });
});

describe("user edits during traces", () => {
  const open: PlayerAction = { type: "start", request: { kind: "openFile" } };

  it("locks the document while a trace is about to change it", () => {
    const state = run([open]);
    expect(fieldLocked(state, "editor")).toBe(true);
    expect(playerReducer(state, { type: "editorText", text: "typed" })).toBe(state);
  });

  it("commits a finished trace before applying an edit, so the edit sticks", () => {
    const done = run([open, { type: "finish" }]);
    expect(fieldLocked(done, "editor")).toBe(false);
    const edited = playerReducer(done, { type: "editorText", text: "my notes" });
    expect(edited.run).toBeNull();
    expect(currentApps(edited).editor).toMatchObject({ file: NOTES_FILE, text: "my notes" });
  });

  it("keeps typing in the base when the trace doesn't touch that field", () => {
    const typing = run([{ type: "start", request: { kind: "keystroke", app: "browser", key: "h" } }]);
    expect(fieldLocked(typing, "draft")).toBe(false);
    const next = playerReducer(typing, { type: "draft", text: "h" });
    expect(next.run).not.toBeNull();
    expect(currentApps(next).browser.draft).toBe("h");
  });
});

describe("power", () => {
  it("shuts down: apps close, the screen goes dark and RAM forgets", () => {
    const warm = run([search, { type: "finish" }, { type: "start", request: { kind: "readFile" } }, { type: "finish" }]);
    expect(warm.machine.pageCache).toContain(NOTES_FILE);
    const off = run([{ type: "start", request: { kind: "shutdown" } }, { type: "finish" }], warm);
    const apps = currentApps(off);
    expect(apps.screen).toBe("off");
    expect(Object.values(apps.windows).every((w) => w === "closed")).toBe(true);
    expect(off.machine).toEqual({ arpCached: false, dnsCached: true, connectionOpen: false, pageCache: [] });
  });

  it("boots to the login screen, and logging in shows the desktop", () => {
    const booted = run([{ type: "start", request: { kind: "boot" } }, { type: "finish" }]);
    expect(currentApps(booted).screen).toBe("login");
    expect(currentApps(booted).bootLog.length).toBeGreaterThan(5);
    const desktop = run([{ type: "start", request: { kind: "login" } }, { type: "finish" }], booted);
    expect(currentApps(desktop).screen).toBe("desktop");
  });

  it("restarts straight through to the login screen", () => {
    const restarted = run([{ type: "start", request: { kind: "restart" } }, { type: "finish" }]);
    expect(currentApps(restarted).screen).toBe("login");
    const ids = restarted.run!.scenario.steps.map((s) => s.id);
    expect(ids).toContain("reset");
    expect(ids).not.toContain("power-button");
  });
});

describe("machine state", () => {
  it("ends every scenario knowing exactly what its steps learned", () => {
    const requests = [
      search,
      { type: "start", request: { kind: "openFile" } },
      { type: "start", request: { kind: "launch", app: "player" } },
      { type: "start", request: { kind: "play", media: "video" } },
      { type: "start", request: { kind: "shutdown" } },
    ] satisfies PlayerAction[];
    let state = INITIAL_PLAYER;
    for (const request of requests) {
      state = playerReducer(state, request);
      expect(machineAt(playerReducer(state, { type: "finish" }))).toEqual(state.machine);
    }
  });

  it("caches a program's file on its first launch", () => {
    const state = run([{ type: "start", request: { kind: "launch", app: "editor" } }]);
    expect(state.machine.pageCache).toEqual([APPS.editor.program]);
  });
});

describe("typing into the terminal", () => {
  const withTerminal: PlayerState = {
    ...INITIAL_PLAYER,
    apps: { ...INITIAL_APPS, windows: { ...INITIAL_APPS.windows, terminal: "open" } },
  };
  const lines = (state: PlayerState) => currentApps(state).terminal.lines.map((l) => l.text);

  it("keeps a line typed during the terminal's trace in the TTY, and reads it when the trace is over", () => {
    let state = run([{ type: "command", text: "./cores" }, { type: "command", text: "2" }], withTerminal);
    expect(state.run?.scenario.title).toBe("./cores");
    expect(state.typedAhead).toEqual(["2"]);
    state = playerReducer(state, { type: "finish" });
    // ./cores asked, and the line was waiting: it reads it at once.
    expect(state.typedAhead).toEqual([]);
    expect(state.run?.scenario.title).toBe("Threads: 2");
    expect(state.run?.status).toBe("playing");
  });

  it("gives each waiting line to whoever reads next: the program, then bash once it has exited", () => {
    let state = run([{ type: "command", text: "./cores" }, { type: "command", text: "0" }, { type: "command", text: "ls" }], withTerminal);
    state = playerReducer(state, { type: "finish" });
    expect(state.run?.scenario.title).toBe("Threads: 0");
    expect(state.typedAhead).toEqual(["ls"]);
    state = playerReducer(state, { type: "finish" });
    expect(state.typedAhead).toEqual([]);
    expect(lines(state).slice(-2)).toEqual(["ls", "Makefile  cores  cores.c  marks  marks.c  notes.txt"]);
  });

  it("prints bash's answers below what the last trace printed", () => {
    const state = run([{ type: "command", text: "cat notes.txt" }, { type: "finish" }, { type: "command", text: "make" }], withTerminal);
    const text = lines(state);
    expect(text.indexOf("make")).toBeGreaterThan(text.indexOf("Notes to self:"));
    expect(state.run).toBeNull();
  });

  it("ends ./marks's input with Ctrl+D at its first question: no student, nothing to free", () => {
    const state = run(
      [{ type: "command", text: "./marks" }, { type: "finish" }, { type: "control", key: "d" }, { type: "finish" }],
      withTerminal,
    );
    const scenario = state.run!.scenario;
    expect(scenario.kind).toBe("programEof");
    expect(scenario.steps.map((x) => x.id)).toEqual(["key", "eof", "wake", "read", "break", "rows", "free", "exit", "exit-mm", "bash"]);
    expect(scenario.steps.find((x) => x.id === "free")?.title).toBe("free(NULL)");
    expect(currentApps(state).program).toMatchObject({ kind: "marks", stage: "exited" });
    expect(currentApps(state).terminal.busy).toBe(false);
  });

  it("frees the name read_marks() was asking marks for when Ctrl+D ends the input", () => {
    const state = run(
      [
        { type: "command", text: "./marks" },
        { type: "finish" },
        { type: "command", text: "Ada" },
        { type: "finish" },
        { type: "control", key: "d" },
        { type: "finish" },
      ],
      withTerminal,
    );
    const ids = state.run!.scenario.steps.map((x) => x.id);
    expect(ids.slice(4, 6)).toEqual(["return", "free-name"]);
    const p = currentApps(state).program;
    if (p?.kind !== "marks") throw new Error("not ./marks");
    expect(p.got).toBe(-1);
    expect(p.heap.chunks.find((c) => c.tag === "name")?.state).toBe("tcache");
  });

  it("ends ./cores's input with Ctrl+D: the array goes back with munmap()", () => {
    const state = run(
      [{ type: "command", text: "./cores" }, { type: "finish" }, { type: "control", key: "d" }, { type: "finish" }],
      withTerminal,
    );
    expect(state.run!.scenario.steps.map((x) => x.id)).toContain("free");
    expect(currentApps(state).program).toMatchObject({ kind: "cores", stage: "exited", mapped: false });
  });

  it("keeps Ctrl+D with the lines typed ahead: it is a byte like the others", () => {
    let state = run([{ type: "command", text: "./cores" }, { type: "control", key: "d" }], withTerminal);
    expect(state.typedAhead).toEqual([EOT]);
    state = playerReducer(state, { type: "finish" });
    expect(state.run?.scenario.kind).toBe("programEof");
  });

  it("echoes ^C at bash's prompt, where nothing runs", () => {
    const state = run([{ type: "control", key: "c" }], withTerminal);
    expect(currentApps(state).terminal.lines.at(-1)).toEqual({ kind: "prompt", text: "^C" });
    expect(state.run).toBeNull();
  });

  it("ends ./marks with Ctrl+C while it reads: SIGINT, and no free() or return from main()", () => {
    const state = run(
      [{ type: "command", text: "./marks" }, { type: "finish" }, { type: "control", key: "c" }, { type: "finish" }],
      withTerminal,
    );
    const scenario = state.run!.scenario;
    expect(scenario.kind).toBe("interrupt");
    expect(scenario.steps.map((x) => x.id)).toEqual(["key", "intr", "deliver", "exit", "exit-mm", "bash"]);
    expect(scenario.steps.find((x) => x.id === "deliver")?.body).toContain("wakes main(), asleep in read()");
    expect(currentApps(state).program).toMatchObject({ kind: "marks", stage: "exited", endedBy: "interrupt", inMain: false });
    expect(currentApps(state).terminal.lines.at(-1)).toMatchObject({ kind: "ask", answer: "^C" });
  });

  it("cuts ./cores's round where the playhead is when Ctrl+C comes, and every thread dies", () => {
    let state = run([{ type: "command", text: "./cores" }, { type: "finish" }, { type: "command", text: "4" }], withTerminal);
    const adding = visibleSteps(state.run!.scenario, state.detail).findIndex((x) => x.id === "add");
    state = run([{ type: "seek", index: adding }, { type: "command", text: "1" }, { type: "control", key: "c" }], state);
    // The interrupt flushes the line typed ahead, as isig() flushes the TTY's input.
    expect(state.typedAhead).toEqual([]);
    expect(state.run?.scenario.kind).toBe("interrupt");
    const deliver = state.run!.scenario.steps.find((x) => x.id === "deliver")!;
    expect(deliver.cores).toEqual([1, 2, 3, 0]);
    expect(deliver.body).toContain("main(), asleep in pthread_join()");
    state = playerReducer(state, { type: "finish" });
    const p = currentApps(state).program;
    if (p?.kind !== "cores") throw new Error("not ./cores");
    expect([p.stage, p.endedBy]).toEqual(["exited", "interrupt"]);
    expect(p.workers.map((w) => w.state)).toEqual(["killed", "killed", "killed", "killed"]);
    // What the round had printed before the cut stays on screen; the rest never happened.
    expect(currentApps(state).terminal.lines.some((l) => l.text.startsWith("thread 1:"))).toBe(false);
  });

  it("throws the waiting lines away when the terminal closes", () => {
    const state = run([{ type: "command", text: "./marks" }, { type: "command", text: "Ada" }, { type: "closeApp", app: "terminal" }], withTerminal);
    expect(state.typedAhead).toEqual([]);
    expect(currentApps(state).program).toBeNull();
  });
});
