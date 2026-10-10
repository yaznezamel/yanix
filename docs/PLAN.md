# Computer Internals Visualizer: Project Plan

Oct 10, 2026 · @Yazn

## Vision

Build an open source, browser based explorer that shows how a computer works inside, from the whole machine down to a single cache line, and lets people watch one request travel through it.

Two ideas carry the product:

- **Zoomable map, C4 style.** The landing view is the whole PC: CPU package, RAM, chipset, storage, NIC. Clicking a component opens the level inside it, the same way LikeC4 lets you drill from a system into its containers and components. CPU opens into cores, shared L3 and the memory controller. A core opens into registers, ALU, L1 and L2, TLB and the pipeline.
- **Traced scenarios.** A user picks a scenario such as "read 4 KB from a file" and presses play. Each hop lights up in order (L1 miss, L2 miss, L3 miss, RAM, page fault, DMA from disk, interrupt) with a latency counter that shows why each layer exists.

Working name: **SiliconMap** (placeholder, change freely).

The gap this fills: existing tools cover one piece each (Ripes for pipelines, Beto and similar for caches, samwho.dev/numbers for latency). None ties DMA, interrupts, caches, RAM and disk into one interactive picture.

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

The MVP ships three zoom levels and three traced scenarios; everything else waits until that loop feels great.

### MVP (v0.1)

- Zoom levels: System, CPU package, CPU core.
- Components: CPU, cores, registers, ALU, L1i, L1d, L2, L3, TLB, memory controller, RAM, PCIe or chipset, NVMe SSD, DMA engine, interrupt controller.
- Scenarios:
  1. Load a value: L1 hit vs full miss down to RAM.
  2. Read a file block: page fault, NVMe read via DMA, interrupt, data lands in RAM then cache.
  3. Cache playground: user sets cache size, associativity and an access pattern; the backend simulates hits and misses.
- Inspector panel per component: what it is, why it exists, typical size and latency, links to further reading.
- Approximate latency figures, clearly labelled as typical orders of magnitude.

### Later (v0.2 and beyond)

- Deeper levels: cache sets and lines, pipeline stages, page table walk.
- Multi core: cache coherence (MESI), false sharing.
- GPU, NIC receive path, context switch, syscall.
- Community authored scenarios submitted as YAML pull requests.
- Compare mode: HDD vs SSD, DDR4 vs DDR5.

### Non goals

- Cycle accurate or vendor accurate simulation (this is a teaching model, not gem5).
- Running real machine code or emulating an ISA.
- User accounts in the MVP.

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

### Non functional

- **NFR1.** The system shall keep canvas animation at 60 fps on a mid range laptop for levels up to 40 nodes.
- **NFR2.** The frontend shall reach a Lighthouse performance score of 90 or more on the landing page.
- **NFR3.** The system shall meet WCAG 2.1 AA: keyboard navigation of nodes, visible focus, text alternatives, reduced motion support.
- **NFR4.** The system shall support light and dark themes.
- **NFR5.** The backend shall answer catalog requests in under 100 ms and simulation requests in under 500 ms for up to 10,000 accesses.
- **NFR6.** The project shall use strict TypeScript and typed Python (mypy or pyright) with no implicit any.
- **NFR7.** The CI pipeline shall run lint, type checks, unit tests and a build on every pull request.
- **NFR8.** The project shall run locally with one command (`docker compose up`).
- **NFR9.** Every latency or size figure shall carry a source link or be labelled as an approximation.
- **NFR10.** The UI shall work on screens from 375 px wide upward, with the canvas usable by touch.

## Component model

Everything on screen comes from content files: components form a tree (the zoom levels), connections live inside a level, and scenarios are ordered steps that reference component ids.

### Zoom levels

1. System: CPU package, RAM, chipset or PCIe root, NVMe SSD, NIC, GPU (later).
   1. CPU package: cores, shared L3, memory controller, interrupt controller, PCIe and IO block.
      1. Core: register file, ALU, load and store unit, L1i, L1d, private L2, TLB, branch predictor.
         1. Cache (later): sets, ways, lines, tags.
   2. RAM: DIMMs, channels, banks (later).
   3. NVMe SSD: controller, DMA engine, flash (later).

### Component file (`content/components/cpu/core/l1d.yaml`)

```yaml
id: cpu.core.l1d
name: L1 data cache
parent: cpu.core
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

```yaml
id: read-file-block
title: Read 4 KB from a file
steps:
  - { at: cpu.core.regs, to: cpu.core.l1d, latency_ns: 1, note: Load instruction asks L1 }
  - { at: cpu.core.l1d, to: cpu.core.l2, latency_ns: 4, note: L1 miss }
  - { at: cpu.core.tlb, latency_ns: 0, note: Page not mapped, page fault raised }
  - { at: ssd.dma, to: ram, latency_ns: 80000, note: SSD copies the block into RAM via DMA, CPU is free }
  - { at: cpu.apic, to: cpu.core, latency_ns: 1000, note: Interrupt signals completion }
```

The backend loads these files into Pydantic models; the same models generate the OpenAPI schema, which generates the TypeScript types. One source of truth from YAML to UI.

## Tech stack

Next.js with React Flow on the front, FastAPI with Pydantic on the back, YAML content in the repo and no database until there is user generated data.

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | Next.js (App Router) + TypeScript strict | The stack I want to learn; file based routing maps cleanly to zoom paths |
| Canvas | React Flow (xyflow) | Nodes, edges, pan and zoom, custom node components; LikeC4 style drilling is natural |
| Auto layout | ELK.js | Clean layered layouts without hand placing every node |
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
siliconmap/
├── web/                      # Next.js app
│   ├── app/
│   │   ├── page.tsx          # System level
│   │   ├── explore/[...path]/page.tsx
│   │   └── scenarios/[id]/page.tsx
│   ├── components/
│   │   ├── canvas/           # React Flow nodes, edges, layout
│   │   ├── inspector/
│   │   └── playback/
│   ├── lib/api/              # generated client + query hooks
│   └── stores/               # Zustand stores
├── api/                      # FastAPI app
│   ├── src/siliconmap/
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

Seven phases, each ending in something that runs, sized for evenings and weekends (roughly 10 to 12 weeks to v0.1).

| Phase | Deliverable | What I learn | Done when |
|---|---|---|---|
| 0. Foundations (1 wk) | Monorepo, Next.js and FastAPI skeletons, compose, CI running lint and tests | Project layout in both ecosystems, uv, pnpm, Actions basics | `docker compose up` shows a page calling `/api/v1/health` |
| 1. Content and catalog API (1.5 wk) | YAML schema, loader, validator, `GET /components`, `GET /levels/{id}` | Pydantic models, routers, dependency injection, pytest | Invalid YAML fails startup with a clear message; tests green |
| 2. Static canvas (2 wk) | System level rendered with React Flow and ELK layout, custom node design | TypeScript basics, components, props, server vs client components | All System components and links render from the API |
| 3. Drill down (2 wk) | Click to expand, breadcrumb, `/explore/[...path]`, zoom transition, inspector | Dynamic routes, layouts, state with Zustand, generated API client | Deep link to cpu/core opens directly; back works |
| 4. Trace playback (2 wk) | Scenario list, play, pause, step, latency counter, cross level following | Custom hooks, effects, animation, timing | Scenario 1 and 2 play end to end across levels |
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
| Beautiful UI eats all the time | Ship phase 2 with plain nodes, design pass in phase 6 |
| Learning two stacks at once stalls progress | Backend phases first (familiar ground), then frontend; one concept per task |
| Animations hurt performance or accessibility | Reduced motion mode from day one; NFR1 checked in phase 4 |

### Open decisions

- [ ] Final project name and domain.
- [ ] Generic "teaching CPU" vs modelled on a real family (for example a modern x86 desktop chip).
- [ ] Traces computed fully on the backend, or scenario steps sent once and animated on the client.
- [ ] Monorepo tooling: plain folders, or Turborepo.
- [ ] Whether the cache playground runs in Python only, or also a TypeScript port for offline use.
