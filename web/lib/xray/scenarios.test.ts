import { describe, expect, it } from "vitest";
import { APPS, COLD_MACHINE, MEDIA, NOTES_FILE } from "./apps";
import { visibleSteps } from "./engine";
import { buildPath, nodeIndexAt } from "./geometry";
import { BANDS, NODES, NODE_IDS, VIEW } from "./nodes";
import { packetAt, packetBytes } from "./packets";
import { buildScenario } from "./scenarios";
import { hidReport, inputEvent, keyInfo, nvmeRead, waylandKey } from "./structs";
import type { MachineState, Scenario, ScenarioRequest } from "./types";

const WARM: MachineState = {
  arpCached: true,
  dnsCached: true,
  connectionOpen: false,
  pageCache: [NOTES_FILE, MEDIA.audio.file, MEDIA.video.file, ...Object.values(APPS).map((a) => a.program)],
};

const requests: ScenarioRequest[] = [
  { kind: "launch", app: "browser" },
  { kind: "launch", app: "terminal" },
  { kind: "launch", app: "editor" },
  { kind: "launch", app: "player" },
  { kind: "search", query: "how does dns work" },
  { kind: "readFile" },
  { kind: "openFile" },
  { kind: "keystroke", app: "browser", key: "h" },
  { kind: "keystroke", app: "editor", key: "?" },
  { kind: "copy", app: "editor", text: "Programs never touch hardware" },
  { kind: "copy", app: "browser", text: "dns" },
  { kind: "paste", app: "browser", source: "editor", text: "page cache" },
  { kind: "paste", app: "editor", source: "browser", text: "dns" },
  { kind: "play", media: "audio" },
  { kind: "play", media: "video" },
  { kind: "boot" },
  { kind: "login" },
  { kind: "shutdown" },
  { kind: "restart" },
];

const label = (r: ScenarioRequest) =>
  [r.kind, "app" in r ? r.app : "", "media" in r ? r.media : ""].filter(Boolean).join(":");

const variants = requests.flatMap((request) =>
  [COLD_MACHINE, WARM, { ...WARM, connectionOpen: true }].map((machine, i) => ({
    name: `${label(request)} (${["cold", "warm", "warm, connected"][i]})`,
    scenario: buildScenario(request, machine),
  })),
);

const ids = (s: Scenario) => s.steps.map((x) => x.id);
const step = (s: Scenario, id: string) => s.steps.find((x) => x.id === id)!;

describe.each(variants)("$name", ({ scenario }) => {
  it("has unique step ids", () => {
    expect(new Set(ids(scenario)).size).toBe(scenario.steps.length);
  });

  it("only visits known nodes, never the same node twice in a row", () => {
    for (const s of scenario.steps) {
      expect(s.path.length).toBeGreaterThan(0);
      s.path.forEach((id, i) => {
        expect(NODE_IDS).toContain(id);
        if (i > 0) expect(s.path[i - 1]).not.toBe(id);
      });
    }
  });

  it("has text, data frames that fit the path, and cache moments at the page cache", () => {
    for (const s of scenario.steps) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.body.length).toBeGreaterThan(20);
      for (const f of s.frames ?? []) {
        expect(f.at).toBeGreaterThanOrEqual(0);
        expect(f.at).toBeLessThan(s.path.length);
        expect(f.packet.headers.length).toBeGreaterThan(0);
      }
      if (s.cache) expect(s.path).toContain("pagecache");
      for (const ref of s.code ?? []) expect(ref.path.length).toBeGreaterThan(2);
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
    expect(ids(cold)).toContain("arp-request");
    expect(ids(cold)).toContain("resolver-root");
    expect(ids(warm)).not.toContain("arp-request");
    expect(ids(warm)).not.toContain("resolver-root");
    expect(ids(warm)).toContain("router-cache");
  });

  it("builds frames outermost header first, 75 bytes on the wire for the query", () => {
    const packet = packetAt(step(cold, "dns-wire").frames, 0)!;
    expect(packet.headers.map((h) => h.kind)).toEqual(["eth", "ip", "udp", "dns"]);
    expect(packetBytes(packet)).toBe(75);
  });

  it("shows the NAT rewrite once the SYN has left the router", () => {
    const nat = step(cold, "tcp-nat");
    expect(packetAt(nat.frames, 1)!.headers.find((h) => h.kind === "ip")?.fields[0]?.value).toBe("192.168.1.23");
    expect(packetAt(nat.frames, 2)!.headers.find((h) => h.kind === "ip")?.fields[0]?.value).toBe("198.51.100.7");
  });

  it("encrypts the request between the network service and the kernel", () => {
    const request = step(cold, "http-request");
    expect(packetAt(request.frames, 0)?.headers[0]?.kind).toBe("http");
    expect(packetAt(request.frames, 1)?.headers.at(-1)?.encrypted).toBe(true);
  });
});

describe("reading a file", () => {
  const touchesSsd = (s: Scenario) => s.steps.some((x) => x.path.includes("ssd"));

  it.each([{ kind: "readFile" } as const, { kind: "openFile" } as const])(
    "$kind only reaches the SSD on a page cache miss",
    (request) => {
      const cold = buildScenario(request, COLD_MACHINE);
      const warm = buildScenario(request, WARM);
      expect(touchesSsd(cold)).toBe(true);
      expect(touchesSsd(warm)).toBe(false);
      expect(step(cold, "cache-miss").cache).toBe("miss");
      expect(step(warm, "cache-hit").cache).toBe("hit");
      expect(step(cold, "dma").learns?.pageCache).toEqual([NOTES_FILE]);
    },
  );

  it("sends a 64-byte NVMe read command, opcode 0x02", () => {
    const cold = buildScenario({ kind: "openFile" }, COLD_MACHINE);
    const command = packetAt(step(cold, "nvme-cmd").frames, 1)!.headers[0]!;
    expect(command.bytes).toBe(64);
    expect(command.fields[0]?.value).toContain("0x02");
    expect(nvmeRead.kind).toBe("nvme");
  });
});

describe("launching an app", () => {
  it("waits for the SSD only the first time, then hits the page cache", () => {
    const cold = buildScenario({ kind: "launch", app: "editor" }, COLD_MACHINE);
    const warm = buildScenario({ kind: "launch", app: "editor" }, WARM);
    expect(step(cold, "page-faults").path).toContain("ssd");
    expect(step(cold, "page-faults").cache).toBe("miss");
    expect(step(warm, "page-faults").path).not.toContain("ssd");
    expect(step(warm, "page-faults").cache).toBe("hit");
    expect(step(cold, "page-faults").learns?.pageCache).toEqual([APPS.editor.program]);
  });

  it("walks clone, copy-on-write, execve, the ELF loader, ld.so and page faults, in that order", () => {
    const s = buildScenario({ kind: "launch", app: "player" }, COLD_MACHINE);
    const order = ["clone", "cow", "execve", "map", "interp", "libraries", "relocate", "page-faults", "draw"];
    const positions = order.map((id) => ids(s).indexOf(id));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("adds the shared libraries to the memory map", () => {
    const s = buildScenario({ kind: "launch", app: "editor" }, COLD_MACHINE);
    const libs = step(s, "libraries");
    const before = packetAt(libs.frames, 0)!.headers.map((h) => h.title);
    const after = packetAt(libs.frames, 3)!.headers.map((h) => h.title);
    for (const lib of APPS.editor.libraries) {
      expect(before).not.toContain(lib);
      expect(after).toContain(lib);
    }
  });
});

describe("a keystroke", () => {
  it("maps characters to HID usages and Linux key codes", () => {
    expect(keyInfo("h")).toMatchObject({ usage: 0x0b, code: 35, name: "KEY_H", shift: false });
    expect(keyInfo("H")).toMatchObject({ usage: 0x0b, code: 35, shift: true });
    expect(keyInfo("a")).toMatchObject({ usage: 0x04, code: 30 });
    expect(keyInfo("1")).toMatchObject({ usage: 0x1e, code: 2 });
    expect(keyInfo("0")).toMatchObject({ usage: 0x27, code: 11 });
    expect(keyInfo(" ")).toMatchObject({ usage: 0x2c, code: 57 });
    expect(keyInfo("?")).toBeNull();
  });

  it("uses the sizes the specifications give", () => {
    expect(hidReport("h").bytes).toBe(8);
    expect(inputEvent("h").bytes).toBe(24);
    expect(waylandKey("h").bytes).toBe(24);
    expect(hidReport("H").fields[0]?.value).toContain("Shift");
  });

  it("goes from the keyboard through the kernel and the compositor to the app", () => {
    const s = buildScenario({ kind: "keystroke", app: "browser", key: "h" }, COLD_MACHINE);
    const visited = s.steps.flatMap((x) => x.path);
    for (const node of ["inputdev", "usbhc", "irq", "usbdrv", "input", "shell", "ipc", "browser", "renderer"] as const) {
      expect(visited).toContain(node);
    }
    expect(step(s, "hid").body).toContain("KEY_H (35)");
  });
});

describe("copy and paste", () => {
  it("copy moves no text through the kernel", () => {
    const s = buildScenario({ kind: "copy", app: "editor", text: "x" }, COLD_MACHINE);
    expect(s.steps.some((x) => x.frames?.some((f) => f.packet.headers.some((h) => h.kind === "pipe")))).toBe(false);
    expect(step(s, "owner").ui?.clipboard).toEqual({ owner: "editor", text: "x" });
  });

  it("paste pipes the text from the owner to the target", () => {
    const s = buildScenario({ kind: "paste", app: "browser", source: "editor", text: "hi" }, COLD_MACHINE);
    expect(step(s, "send").path.at(-1)).toBe("editor");
    expect(step(s, "write").path[0]).toBe("editor");
    expect(step(s, "read").path.at(-1)).toBe("browser");
    expect(packetAt(step(s, "write").frames, 2)!.headers[0]!.bytes).toBe(2);
  });
});

describe("playing media", () => {
  it("adds the picture path for a video", () => {
    const audio = buildScenario({ kind: "play", media: "audio" }, COLD_MACHINE);
    const video = buildScenario({ kind: "play", media: "video" }, COLD_MACHINE);
    for (const id of ["video-decode", "present", "vblank"]) {
      expect(ids(audio)).not.toContain(id);
      expect(ids(video)).toContain(id);
    }
  });

  it("states PipeWire's defaults and the real-time policy", () => {
    const s = buildScenario({ kind: "play", media: "audio" }, COLD_MACHINE);
    expect(step(s, "quantum").body).toContain("1,024 samples");
    expect(step(s, "quantum").body).toContain("21 ms");
    expect(step(s, "realtime").body).toContain("SCHED_FIFO");
    expect(step(s, "codec").path).toEqual(["hda", "speakers"]);
  });
});

describe("power", () => {
  it("boots from the power button to the login screen", () => {
    const s = buildScenario({ kind: "boot" }, COLD_MACHINE);
    expect(s.steps[0]?.id).toBe("power-button");
    expect(s.steps.at(-2)?.ui?.screen).toBe("login");
  });

  it("asks for an address with DHCP from 0.0.0.0 to everyone", () => {
    const s = buildScenario({ kind: "boot" }, COLD_MACHINE);
    const discover = packetAt(step(s, "dhcp-discover").frames, 3)!;
    expect(discover.headers.map((h) => h.kind)).toEqual(["eth", "ip", "udp", "dhcp"]);
    expect(discover.headers[1]?.fields[0]?.value).toContain("0.0.0.0");
    expect(discover.headers[1]?.fields[1]?.value).toContain("255.255.255.255");
    expect(discover.headers[2]?.fields[0]?.value).toBe("68 (DHCP client)");
  });

  it("forgets RAM at power-off but keeps the router's DNS cache", () => {
    const s = buildScenario({ kind: "shutdown" }, WARM);
    const off = step(s, "power-off");
    expect(off.ui?.screen).toBe("off");
    expect(off.learns).toEqual({ arpCached: false, connectionOpen: false, pageCache: [] });
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
    expect(buildPath(["resolver", "tld", "resolver"]).points.length).toBeGreaterThan(3);
  });

  it("runs up the side of the kernel's middle column instead of through its boxes", () => {
    const up = buildPath(["usbdrv", "input"]);
    expect(up.points.some((p) => p.x === 516)).toBe(true);
    const out = buildPath(["input", "syscall", "shell"]);
    expect(out.points.filter((p) => p.x === 516).length).toBe(2);
    const direct = buildPath(["proc", "syscall", "shell"]);
    expect(direct.points.length).toBe(3);
  });
});
