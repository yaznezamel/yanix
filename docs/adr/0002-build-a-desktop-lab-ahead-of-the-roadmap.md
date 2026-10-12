# 0002. Build a desktop lab ahead of the roadmap

- Status: accepted
- Date: 2026-10-10

## Context

I wanted a mode where I use a simulated desktop, with a taskbar and windows
in the style of Windows 11, and watch what each action does inside the
machine: open the browser, search, and follow the traffic from user space
through the kernel and the network card, out to the DNS resolver and the web
server. I asked for it to be built in one go rather than task by task.

The roadmap puts trace playback in phase 4 and lists the network path (NIC,
NAPI, network stack, socket) under Later. Phase 1, the content API, does not
exist yet, so there is no YAML or endpoint to load scenarios from (FR10,
FR12).

## Options considered

1. Wait until phase 4 and build it on React Flow and the content API.
   Follows the plan, but the most motivating demo arrives last.
2. Build it now as its own route, `/desktop`, with a small playback engine
   and scenario data in TypeScript, and move the data to YAML once the API
   serves scenarios. A working demo now; some code moves later.
3. Build it now inside the planned `/explore` map. Forces choices that
   phases 2 to 4 have not made yet (React Flow layout, Zustand, routes).

## Decision

Option 2. The desktop lab lives at `/desktop` and is built from:

- a pure reducer, `web/lib/xray/engine.ts`, that plays scripted steps. The
  apps on screen are derived from the steps, so stepping back also rewinds
  the screen. Machine state (ARP entry, DNS cache, open connection, page
  cache) carries over between runs, so a second search skips cached work;
- scenario data in TypeScript, `web/lib/xray/scenarios.ts`, until the API
  can serve it;
- a hand-placed SVG machine view animated with Motion. React Flow stays the
  plan for the zoomable map in phases 2 and 3;
- an original desktop look, with no Microsoft or Google names, logos or
  icons. The browser follows Chromium's process model (browser, renderer and
  network service);
- documentation-only addresses (RFC 5737 IPs, RFC 7042 MACs, example.com),
  so nothing points at a real host.

## Consequences

- The project has an end-to-end demo from user space to the kernel, the
  hardware and the network today, with the engine covered by Vitest tests.
  The reducer is a starting point for phase 4's `usePlayback` hook.
- FR12 does not hold for the lab yet: its scenarios are code, not YAML.
  They move to `content/scenarios/` once phase 1's API serves scenarios.
- NFR9 is open for the lab: kernel paths name current source files but are
  not pinned to a release. Pin them when task 1.6 picks the release.
- NFR4 is open: the lab is dark only until phase 6.1. NFR10 holds in part:
  the page works from 375 px wide, but the desktop is small on a phone.
- The open decision in phase 4.0 (where traces run) is informed, not
  settled: the lab animates steps on the client because there is no API.
- I did not write this code, so the roadmap adds tasks to study and extend
  it before relying on it.
- Simplifications, stated in the lab: wired Ethernet, IPv4 only, glibc's
  resolver, an ISP resolver that walks from the root, HTTP/2 over TLS 1.3.
- Revisit when the content API lands, or if keeping two playback engines
  (the lab and phase 4) costs more than merging them.
