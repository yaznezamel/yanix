import { describe, expect, it } from "vitest";
import {
  INITIAL_PLAYER,
  appsAt,
  currentApps,
  currentStep,
  machineAt,
  playerReducer,
  remapIndex,
  stepMs,
  travelMs,
  visibleSteps,
  type PlayerAction,
  type PlayerState,
} from "./engine";
import { buildScenario, COLD_MACHINE } from "./scenarios";

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
      fileCached: false,
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
    const scenario = buildScenario({ kind: "search", query: "q" }, COLD_MACHINE);
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
    const scenario = buildScenario({ kind: "search", query: "q" }, COLD_MACHINE);
    const long = scenario.steps.find((s) => s.path.length > 6)!;
    const single = scenario.steps.find((s) => s.path.length === 1)!;
    expect(travelMs(single, 1)).toBe(0);
    expect(travelMs(long, 1)).toBeGreaterThan(1000);
    expect(stepMs(long, 2)).toBeCloseTo(stepMs(long, 1) / 2);
  });
});
