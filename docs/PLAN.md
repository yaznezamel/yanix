# Computer Internals Visualizer: Project Plan

Oct 10, 2026 · @Yazn

## Vision

Build an open source, browser based explorer that shows how a computer works inside, **from a syscall down to silicon**: the Linux kernel subsystems a request passes through and the hardware underneath them, from the whole machine down to a single cache line. It lets people watch one request travel through both.

Two ideas carry the product:

- **Zoomable map, C4 style.** The landing view is the whole machine: a user process, the Linux kernel, CPU package, RAM, chipset, storage, NIC. Clicking a component opens the level inside it, the same way LikeC4 lets you drill from a system into its containers and components. The kernel opens into its subsystems (syscall entry, VFS, page cache, block layer, NVMe driver, interrupt handling, scheduler). CPU opens into cores, shared L3 and the memory controller. A core opens into registers, ALU, L1 and L2, TLB and the pipeline.
- **Traced scenarios.** A user picks a scenario such as "read 4 KB from a file" and presses play. Each hop lights up in order, across both planes: `read()` enters the kernel, VFS, page cache miss, block layer, NVMe driver rings the doorbell, the SSD DMAs the block into RAM, an interrupt fires, the process wakes and the data is copied to user space. A latency counter shows why each layer exists.

Name: **Yanix**.

**Visual direction.** Hardware levels look like the real thing, seen from above: a motherboard with a CPU socket and heat spreader, DIMMs, an M.2 SSD and a chipset heatsink; the CPU opens into a die floorplan (cores, L3 slices, ring bus, memory controller and PCIe with their PHY strips); a core opens into its floorplan, where caches show as regular SRAM grids and logic as irregular cells. Floorplans are illustrative, not a real chip, and say so. Kernel levels are software, so they use a clean diagram style. Signals between parts glow and move along the path. A clickable prototype of this look was built before implementation.

The gap this fills: existing tools cover one piece each (Ripes for pipelines, Beto and similar for caches, samwho.dev/numbers for latency, static kernel diagrams such as the Linux kernel map). None ties a syscall, kernel subsystems, DMA, interrupts, caches, RAM and disk into one interactive picture.

It is a **teaching model**: content is hand written and traces are scripted. It does not trace a live kernel (see Non goals).

## Learning goals

The project is a vehicle for learning Next.js (TypeScript) and deepening FastAPI, so each feature is chosen to force one new concept, and the assistant teaches rather than writes everything.

| Area | Concepts I will learn | Where in the project it shows up |
|---|---|---|
| TypeScript | Types, interfaces, unions, generics, narrowing | Component and scenario types shared with the API |
| Next.js | App Router, layouts, server vs client components, dynamic routes, loading and error states | `/explore/[...path]` drill down routes, scenario pages |
| React | State, effects, context, custom hooks, memoization | Canvas state, playback controls, inspector panel |
| Frontend craft | Tailwind, accessible components, animation, responsive layout | The visual layer and the trace animation |
| FastAPI | Routers, dependency injection, Pydantic v2 models, validation, OpenAPI | Catalog API and simulation endpoints |
| Python engineering | Typed Python, project layout, uv, pytest, Ruff | Simulation engine and its tests |
| Integration | Generated TypeScript client from OpenAPI, CORS, env config | The seam between Next.js and FastAPI |
| Delivery | Docker, compose, GitHub Actions, preview deploys | CI and release pipeline (my home turf, kept light) |

My learning style: first principles, understand the why before the how, guided hints before full solutions.

## Scope

The MVP ships three zoom levels and three traced scenarios; everything else waits until that loop feels great. The desktop lab is the one exception, built early on request (ADR 0002).

### MVP (v0.1)

- Zoom levels: System, CPU package, CPU core, Kernel (one level of subsystems, no deeper).
- Hardware components: CPU, cores, registers, ALU, L1i, L1d, L2, L3, TLB, memory controller, RAM, PCIe or chipset, NVMe SSD, DMA engine, interrupt controller.
- Kernel components: syscall entry, VFS, page cache, filesystem (one, e.g. ext4), block layer, NVMe driver, interrupt handling, scheduler.
- User space: one process node at System level, the starting point of syscall traces.
- Scenarios:
  1. Load a value: L1 hit vs full miss down to RAM (hardware only).
  2. `read()` a file block, syscall to silicon: syscall entry, VFS, page cache miss, filesystem maps the block, block layer, NVMe driver submits the command, SSD DMAs the block into RAM, interrupt, the waiting process is woken, data is copied to the user buffer. Ends with a second `read()` of the same block that hits the page cache, to show why the cache exists.
  3. Cache playground: user sets cache size, associativity and an access pattern; the backend simulates hits and misses.
- Inspector panel per component: what it is, why it exists, typical size and latency, links to further reading. Kernel components also link to their source and docs at the pinned kernel version.
- Approximate latency figures, clearly labelled as typical orders of magnitude.
- Kernel content targets one pinned Linux release (see Open decisions), stated in the UI.
- Desktop lab, built ahead of the phases (ADR 0002, ADR 0003): a simulated desktop at `/desktop` whose every action is traced through user space, the kernel, the hardware and the network. Scenarios: boot, login, shutdown and restart; launching an app (fork, exec, ELF loading, dynamic linking, page faults); opening a file (page cache hit or miss, NVMe, DMA); typing (USB, HID, evdev, Wayland); a web search (DNS, ARP, NAT, TCP, TLS, HTTP/2); playing sound and video (PipeWire, real-time scheduling, HD Audio); copy and paste. A Hardware tab next to the software path zooms from the motherboard into the CPU and a core, lit by the same traces (ADR 0004).

### Later (v0.2 and beyond)

- Deeper levels: cache sets and lines, pipeline stages, page table walk.
- Deeper kernel levels: scheduler internals, memory management (page fault handling, `mmap`), page table walk from the kernel side.
- Kernel scenarios: page fault on an `mmap`ed file, context switch, `write()` and writeback, `fork()`/`exec()`, `io_uring` vs `read()`.
- Multi core: cache coherence (MESI), false sharing.
- GPU internals. Deeper network levels (netfilter, TCP congestion control, Wi-Fi); the desktop lab covers the basic path through the socket, the network stack, the driver and the NIC.
- Community authored scenarios submitted as YAML pull requests.
- Compare mode: HDD vs SSD, DDR4 vs DDR5.

### Non goals

- Cycle accurate or vendor accurate simulation (this is a teaching model, not gem5).
- Running real machine code or emulating an ISA.
- User accounts in the MVP.
- Tracing a live kernel (eBPF, ftrace, perf). Traces are scripted teaching content, not recordings.
- Modelling every subsystem, driver or architecture. One filesystem, one storage driver, one generic CPU.

## Requirements

### Functional

- **FR1.** The system shall render the System level view on first load, showing every top level component and its connections.
- **FR2.** The system shall let the user open any expandable component to show its child level, with an animated zoom transition.
- **FR3.** The system shall show a breadcrumb of the current path and let the user return to any parent level in one click.
- **FR4.** The system shall give each level a shareable URL, so a deep link opens that level directly.
- **FR5.** The system shall show an inspector panel for the selected component with description, purpose, typical capacity, typical latency and references.
- **FR6.** The system shall list available scenarios and let the user play, pause, step forward, step back and reset a trace.
- **FR7.** The system shall highlight the active component and the active connection for each trace step, and show cumulative latency.
- **FR8.** The system shall follow a trace across zoom levels, zooming in or out when the next step lives at another level.
- **FR9.** The cache playground shall accept cache size, line size, associativity, replacement policy and an access pattern, and return a hit and miss trace from the backend.
- **FR10.** The backend shall expose the component catalog and scenarios through a versioned REST API (`/api/v1`).
- **FR11.** The backend shall validate every component and scenario file against a schema at startup and reject invalid content with a clear error.
- **FR12.** The system shall let contributors add a component or scenario by adding a YAML file, with no code change.
- **FR13.** The system shall mark every component with its layer (user space, kernel or hardware) and render the layers so they are visually distinct, including during a trace that crosses between them.

### Non functional

- **NFR1.** The system shall keep canvas animation at 60 fps on a mid range laptop for levels up to 40 nodes.
- **NFR2.** The frontend shall reach a Lighthouse performance score of 90 or more on the landing page.
- **NFR3.** The system shall meet WCAG 2.1 AA: keyboard navigation of nodes, visible focus, text alternatives, reduced motion support.
- **NFR4.** The system shall support light and dark themes.
- **NFR5.** The backend shall answer catalog requests in under 100 ms and simulation requests in under 500 ms for up to 10,000 accesses.
- **NFR6.** The project shall use strict TypeScript and typed Python (mypy or pyright) with no implicit any.
- **NFR7.** The CI pipeline shall run lint, type checks, unit tests and a build on every pull request.
- **NFR8.** The project shall run locally with one command (`docker compose up`).
- **NFR9.** Every latency or size figure shall carry a source link or be labelled as an approximation. Every kernel function, structure or behaviour named in content shall link to the source (e.g. elixir.bootlin.com) or documentation (docs.kernel.org) at the pinned kernel version.
- **NFR10.** The UI shall work on screens from 375 px wide upward, with the canvas usable by touch.

## Component model

Everything on screen comes from content files: components form a tree (the zoom levels), connections live inside a level, and scenarios are ordered steps that reference component ids. Every component has a `layer` (`user`, `kernel` or `hardware`), so one tree and one trace engine cover both planes (FR13).

### Zoom levels

1. System: user process, Linux kernel, CPU package, RAM, chipset or PCIe root, NVMe SSD, NIC, GPU (later).
   1. Kernel: syscall entry, VFS, page cache, filesystem, block layer, NVMe driver, interrupt handling, scheduler.
      1. Subsystem internals (later): e.g. scheduler run queues, memory management, network stack.
   2. CPU package: cores, shared L3, memory controller, interrupt controller, PCIe and IO block.
      1. Core: register file, ALU, load and store unit, L1i, L1d, private L2, TLB, branch predictor.
         1. Cache (later): sets, ways, lines, tags.
   3. RAM: DIMMs, channels, banks (later).
   4. NVMe SSD: controller, DMA engine, flash (later).

### Component file (`content/components/cpu/core/l1d.yaml`)

```yaml
id: cpu.core.l1d
name: L1 data cache
parent: cpu.core
layer: hardware
kind: cache
summary: Smallest, fastest cache, private to one core, holds data the core is using right now.
why: RAM is about 100x slower than a register. L1 hides most of that gap for hot data.
specs:
  capacity: "32 to 64 KB per core"
  latency_ns: 1
  line_size_bytes: 64
expandable: false
references:
  - title: What Every Programmer Should Know About Memory
    url: https://people.freebsd.org/~lstewart/articles/cpumemory.pdf
```

### Kernel component file (`content/components/kernel/pagecache.yaml`)

Kernel components have no hardware specs; they name the code that implements them, linked at the pinned kernel version (NFR9).

```yaml
id: kernel.pagecache
name: Page cache
parent: kernel
layer: kernel
kind: cache
summary: File contents the kernel keeps in RAM, so repeated reads do not go to the disk.
why: An NVMe read is orders of magnitude slower than a RAM access. Keeping recently used file pages in otherwise free RAM hides that gap.
source:
  - symbol: filemap_read
    file: mm/filemap.c
    url: https://elixir.bootlin.com/linux/<pinned-version>/source/mm/filemap.c
expandable: false
references:
  - title: "Kernel docs: Page Cache"
    url: https://docs.kernel.org/<check-path-at-pinned-version>
```

### Level file (`content/levels/cpu.core.yaml`)

Lists child placement hints and connections:

```yaml
level: cpu.core
connections:
  - { from: cpu.core.regs, to: cpu.core.l1d, label: load/store }
  - { from: cpu.core.l1d, to: cpu.core.l2, label: miss }
  - { from: cpu.core.l2, to: cpu.l3, label: miss, crosses_level: true }
```

### Scenario file (`content/scenarios/read-file-block.yaml`)

The flagship trace crosses user space, kernel and hardware. Steps without `latency_ns` have no sourced figure yet; NFR9 applies before any number is added.

```yaml
id: read-file-block
title: read() 4 KB from a file, syscall to silicon
steps:
  - { at: user.process, to: kernel.syscall, note: "read(fd, buf, 4096) traps into the kernel" }
  - { at: kernel.syscall, to: kernel.vfs, note: VFS resolves the open file and calls into the read path }
  - { at: kernel.vfs, to: kernel.pagecache, note: Page cache lookup misses, the block is not in RAM }
  - { at: kernel.pagecache, to: kernel.fs, note: Filesystem maps the file offset to a block on disk }
  - { at: kernel.fs, to: kernel.block, note: An I/O request is submitted to the block layer }
  - { at: kernel.block, to: kernel.nvme, note: NVMe driver writes a command to the submission queue and rings the doorbell }
  - { at: kernel.sched, note: The process sleeps on the I/O; the scheduler runs something else }
  - { at: ssd.dma, to: ram, latency_ns: 80000, note: SSD copies the block into a page cache page via DMA, CPU is free }
  - { at: ssd, to: cpu.apic, latency_ns: 1000, note: Completion interrupt (MSI-X) }
  - { at: cpu.apic, to: kernel.irq, note: Interrupt handler completes the request }
  - { at: kernel.irq, to: kernel.sched, note: The waiting process is woken }
  - { at: kernel.pagecache, to: user.process, note: copy_to_user copies the data into the user buffer; read() returns }
```

The backend loads these files into Pydantic models; the same models generate the OpenAPI schema, which generates the TypeScript types. One source of truth from YAML to UI.

## Tech stack

Next.js with React Flow on the front, FastAPI with Pydantic on the back, YAML content in the repo and no database until there is user generated data.

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | Next.js (App Router) + TypeScript strict | The stack I want to learn; file based routing maps cleanly to zoom paths |
| Canvas | React Flow (xyflow); the desktop lab's hardware view is SVG with its own camera (ADR 0004) | Nodes, edges, pan and zoom, custom node components; LikeC4 style drilling is natural. The hardware view needed nested floorplans, semantic zoom and one clock with the traces, which React Flow fights |
| Layout | Hand placed coordinates for hardware levels; ELK.js for kernel levels | A realistic board needs parts where they really sit; software diagrams lay out well automatically |
| Animation | Motion (formerly Framer Motion) | Zoom transitions and trace pulses with reduced motion support |
| Styling | Tailwind CSS + shadcn/ui | Fast, consistent, accessible primitives I own the code of |
| Client state | Zustand | Small store for selection, playback and current path |
| Data fetching | TanStack Query + generated client (openapi-typescript) | Caching and typed calls straight from the FastAPI schema |
| Backend | FastAPI + Pydantic v2 | Typed models, validation and OpenAPI for free |
| Python tooling | uv, Ruff, pytest, pyright | Fast installs, one linter, tests, type safety |
| Content | YAML files in `content/` | Contributors add knowledge with a pull request, reviewable diffs |
| Storage (later) | SQLite then Postgres | Only once users save custom scenarios |
| Packaging | Docker + docker compose | One command local run |
| CI | GitHub Actions | Lint, types, tests, build, preview deploy |
| Hosting | Frontend on Vercel, API as a container (Fly.io, Render or any cloud) | Free tiers fit an open source project |

Why a backend at all: the catalog could be static, but the cache playground and any parameterised trace need real computation. Keeping simulation in Python makes it testable and gives FastAPI real work to do.

## Repository structure

One monorepo with three top level parts: web, api and content.

```
yanix/
├── web/                      # Next.js app
│   ├── app/
│   │   ├── page.tsx          # System level
│   │   ├── explore/[...path]/page.tsx
│   │   ├── scenarios/[id]/page.tsx
│   │   └── desktop/page.tsx  # desktop lab (ADR 0002)
│   ├── components/
│   │   ├── canvas/           # React Flow nodes, edges, layout
│   │   ├── desktop/          # simulated desktop, browser, terminal
│   │   ├── hardware/         # zoomable hardware view (ADR 0004)
│   │   ├── lab/              # machine view, narration, packet panel
│   │   ├── inspector/
│   │   └── playback/
│   ├── lib/api/              # generated client + query hooks
│   ├── lib/hardware/         # hardware hierarchy, camera, activity
│   ├── lib/xray/             # desktop lab engine and scenarios
│   └── stores/               # Zustand stores
├── api/                      # FastAPI app
│   ├── src/yanix/
│   │   ├── main.py
│   │   ├── routers/          # catalog.py, scenarios.py, simulate.py
│   │   ├── models/           # Pydantic models
│   │   ├── content/          # YAML loader and validator
│   │   └── sim/              # cache simulator, trace builder
│   ├── tests/
│   └── pyproject.toml
├── content/                  # components/, levels/, scenarios/
├── docs/                     # architecture notes, ADRs
├── .github/workflows/
├── docker-compose.yml
├── CONTRIBUTING.md
└── LICENSE
```

## Milestones

Seven phases, each ending in something that runs, sized for evenings and weekends (roughly 11 to 13 weeks to v0.1; the kernel plane adds about a week, mostly content writing in phase 1).

| Phase | Deliverable | What I learn | Done when |
|---|---|---|---|
| 0. Foundations (1 wk) | Monorepo, Next.js and FastAPI skeletons, compose, CI running lint and tests | Project layout in both ecosystems, uv, pnpm, Actions basics | `docker compose up` shows a page calling `/api/v1/health` |
| 1. Content and catalog API (2 wk) | YAML schema (with `layer`), loader, validator, `GET /components`, `GET /levels/{id}`, hardware and kernel content for the MVP levels | Pydantic models, routers, dependency injection, pytest | Invalid YAML fails startup with a clear message; tests green |
| 2. Static canvas (2 wk) | System level rendered with React Flow and ELK layout, custom node design | TypeScript basics, components, props, server vs client components | All System components and links render from the API, with user, kernel and hardware layers visually distinct |
| 3. Drill down (2 wk) | Click to expand, breadcrumb, `/explore/[...path]`, zoom transition, inspector | Dynamic routes, layouts, state with Zustand, generated API client | Deep links to cpu/core and kernel open directly; back works |
| 4. Trace playback (2 wk) | Scenario list, play, pause, step, latency counter, cross level following | Custom hooks, effects, animation, timing | Scenario 1 and 2 play end to end across levels; scenario 2 crosses user, kernel and hardware |
| 5. Cache playground (1.5 wk) | `POST /simulate/cache` plus UI form and hit or miss visual | Algorithms in Python, request validation, forms in React | Results match hand calculated examples in tests |
| 6. Polish and launch (1.5 wk) | Dark mode, a11y pass, mobile, README with GIF, deploy, CONTRIBUTING | Performance profiling, accessibility, release process | Public URL live, v0.1 tagged, first issues labelled |

Rule for every phase: write a short ADR in `docs/adr/` for any decision that took more than ten minutes.

## Open source setup

MIT licence for code, CC BY 4.0 for the explanatory content, and a contribution path that lets non coders add knowledge.

- `LICENSE` (MIT) at the root and `content/LICENSE` (CC BY 4.0).
- `CONTRIBUTING.md` with two tracks: content contributions (add or fix a YAML file) and code contributions.
- `CODE_OF_CONDUCT.md` (Contributor Covenant).
- Issue templates: bug, new component, new scenario, factual correction (requires a source).
- Labels: good first issue, content, web, api, help wanted.
- Branch protection on main: CI green and one review.
- Conventional Commits and an automated changelog (release-please).
- README: one line pitch, animated GIF of a trace, quick start, architecture link, roadmap.

## Instructions for the AI assistant

These live in [`CLAUDE.md`](../CLAUDE.md) at the repository root, which Claude Code loads automatically at the start of every session.

## Risks and open decisions

The biggest risk is scope: hardware is endless, so the MVP stays at three levels and three scenarios until it feels great.

| Risk | Mitigation |
|---|---|
| Scope creep into deeper levels | Hard MVP list; new ideas go to a Later issue label |
| Wrong or oversimplified facts | Source on every figure; factual correction template; simplifications called out in the inspector |
| Beautiful UI eats all the time | Realistic hardware art is a goal, so budget it: reusable SVG parts (chip, DIMM, M.2, SRAM block, logic block) built once in phase 2, then reused; plain kernel nodes until phase 6 |
| Learning two stacks at once stalls progress | Backend phases first (familiar ground), then frontend; one concept per task |
| Animations hurt performance or accessibility | Reduced motion mode from day one; NFR1 checked in phase 4 |
| Kernel internals change between releases | Pin one kernel release; link every symbol to source at that version; note the version in the UI |
| Kernel plane doubles the scope | MVP kernel level is one level deep with one scenario; deeper kernel levels and scenarios go to Later |
| Kernel facts are subtle and easy to get wrong | Every kernel claim links to source or docs; factual correction template applies to kernel content too |

### Open decisions

- [x] Project name: Yanix. Domain still open.
- [ ] Which kernel release to pin (a current LTS from kernel.org/category/releases.html).
- [ ] Which filesystem the read trace uses (ext4 is the likely default).
- [x] Generic "teaching CPU" vs modelled on a real family: generic and labelled illustrative, with no unsourced sizes or speeds (ADR 0004).
- [ ] Traces computed fully on the backend, or scenario steps sent once and animated on the client.
- [ ] Monorepo tooling: plain folders, or Turborepo.
- [ ] Whether the cache playground runs in Python only, or also a TypeScript port for offline use.
