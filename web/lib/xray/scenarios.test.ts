import { describe, expect, it } from "vitest";
import { visibleSteps } from "./engine";
import { buildPath, nodeIndexAt } from "./geometry";
import { BANDS, NODES, NODE_IDS, VIEW } from "./nodes";
import { packetAt, packetBytes } from "./packets";
import { COLD_MACHINE, buildScenario } from "./scenarios";
import type { MachineState, ScenarioRequest } from "./types";

const WARM: MachineState = {
  arpCached: true,
  dnsCached: true,
  connectionOpen: false,
  fileCached: true,
};

const requests: ScenarioRequest[] = [
  { kind: "launch", app: "browser" },
  { kind: "launch", app: "terminal" },
  { kind: "search", query: "how does dns work" },
  { kind: "readFile" },
];

const variants = requests.flatMap((request) =>
  [COLD_MACHINE, WARM, { ...WARM, connectionOpen: true }].map((machine) => ({
    name: `${request.kind}${"app" in request ? `:${request.app}` : ""} (${JSON.stringify(machine)})`,
    scenario: buildScenario(request, machine),
  })),
);

describe.each(variants)("$name", ({ scenario }) => {
  it("has unique step ids", () => {
    const ids = scenario.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only visits known nodes, never the same node twice in a row", () => {
    for (const step of scenario.steps) {
      expect(step.path.length).toBeGreaterThan(0);
      step.path.forEach((id, i) => {
        expect(NODE_IDS).toContain(id);
        if (i > 0) expect(step.path[i - 1]).not.toBe(id);
      });
    }
  });

  it("has text and packet frames that fit the path", () => {
    for (const step of scenario.steps) {
      expect(step.title.length).toBeGreaterThan(3);
      expect(step.body.length).toBeGreaterThan(20);
      for (const f of step.frames ?? []) {
        expect(f.at).toBeGreaterThanOrEqual(0);
        expect(f.at).toBeLessThan(step.path.length);
        expect(f.packet.headers.length).toBeGreaterThan(0);
      }
    }
  });

  it("plays in both detail levels", () => {
    expect(visibleSteps(scenario, "overview").length).toBeGreaterThan(2);
    expect(visibleSteps(scenario, "deep").length).toBeGreaterThanOrEqual(
      visibleSteps(scenario, "overview").length - 6,
    );
  });
});

describe("web search", () => {
  const cold = buildScenario({ kind: "search", query: "q" }, COLD_MACHINE);
  const warm = buildScenario({ kind: "search", query: "q" }, WARM);

  it("asks ARP and walks the DNS tree only when the caches are cold", () => {
    const ids = (s: typeof cold) => s.steps.map((x) => x.id);
    expect(ids(cold)).toContain("arp-request");
    expect(ids(cold)).toContain("resolver-root");
    expect(ids(warm)).not.toContain("arp-request");
    expect(ids(warm)).not.toContain("resolver-root");
    expect(ids(warm)).toContain("router-cache");
  });

  it("builds frames outermost header first, 75 bytes on the wire for the query", () => {
    const wire = cold.steps.find((s) => s.id === "dns-wire")!;
    const packet = packetAt(wire.frames, 0)!;
    expect(packet.headers.map((h) => h.kind)).toEqual(["eth", "ip", "udp", "dns"]);
    expect(packetBytes(packet)).toBe(75);
  });

  it("shows the NAT rewrite once the SYN has left the router", () => {
    const nat = cold.steps.find((s) => s.id === "tcp-nat")!;
    const before = packetAt(nat.frames, 1)!;
    const after = packetAt(nat.frames, 2)!;
    expect(before.headers.find((h) => h.kind === "ip")?.fields[0]?.value).toBe("192.168.1.23");
    expect(after.headers.find((h) => h.kind === "ip")?.fields[0]?.value).toBe("198.51.100.7");
  });

  it("encrypts the request between the network service and the kernel", () => {
    const request = cold.steps.find((s) => s.id === "http-request")!;
    expect(packetAt(request.frames, 0)?.headers[0]?.kind).toBe("http");
    expect(packetAt(request.frames, 1)?.headers.at(-1)?.encrypted).toBe(true);
  });
});

describe("read file", () => {
  it("only touches the SSD on a page cache miss", () => {
    const cold = buildScenario({ kind: "readFile" }, COLD_MACHINE);
    const warm = buildScenario({ kind: "readFile" }, WARM);
    const touchesSsd = (s: typeof cold) => s.steps.some((x) => x.path.includes("ssd"));
    expect(touchesSsd(cold)).toBe(true);
    expect(touchesSsd(warm)).toBe(false);
  });
});

describe("machine map", () => {
  it("keeps every node inside the view and inside its layer's band", () => {
    for (const id of NODE_IDS) {
      const n = NODES[id];
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(VIEW.width);
      expect(n.y + n.h).toBeLessThanOrEqual(VIEW.height);
      const band = BANDS.find((b) => b.layer === n.layer)!;
      expect(n.x).toBeGreaterThanOrEqual(band.x);
      expect(n.y).toBeGreaterThanOrEqual(band.y);
      expect(n.x + n.w).toBeLessThanOrEqual(band.x + band.w);
      expect(n.y + n.h).toBeLessThanOrEqual(band.y + band.h);
    }
  });

  it("has no overlapping nodes", () => {
    for (const a of NODE_IDS) {
      for (const b of NODE_IDS) {
        if (a >= b) continue;
        const p = NODES[a];
        const q = NODES[b];
        const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
        expect(overlap, `${a} overlaps ${b}`).toBe(false);
      }
    }
  });
});

describe("geometry", () => {
  it("reaches every node of a path in order", () => {
    const g = buildPath(["glibc", "syscall", "socket", "udp", "ip"]);
    expect(g.d.startsWith("M ")).toBe(true);
    expect(g.nodeAt[0]).toBe(0);
    expect(g.nodeAt.at(-1)).toBeCloseTo(1);
    for (let i = 1; i < g.nodeAt.length; i++) {
      expect(g.nodeAt[i]!).toBeGreaterThan(g.nodeAt[i - 1]!);
    }
    expect(nodeIndexAt(g.nodeAt, 0)).toBe(0);
    expect(nodeIndexAt(g.nodeAt, 1)).toBe(4);
  });

  it("enters the system call bar right below its neighbours", () => {
    const g = buildPath(["glibc", "syscall", "socket"]);
    const bar = g.points[1]!;
    expect(bar.y).toBe(NODES.syscall.y + NODES.syscall.h / 2);
    expect(bar.x).toBeGreaterThan(560);
  });

  it("routes DNS referrals around the other name servers", () => {
    const g = buildPath(["resolver", "tld", "resolver"]);
    expect(g.points.length).toBeGreaterThan(3);
  });
});
