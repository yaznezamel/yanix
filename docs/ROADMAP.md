# Yanix roadmap: phases and tasks

The task-level breakdown of the Milestones table in [`PLAN.md`](PLAN.md).
Each task is one learning step and roughly one commit. Work them in order.

## How to use this file (for the assistant)

- Find the current task in the Progress section of [`CLAUDE.md`](../CLAUDE.md).
- For each task: explain the concepts first, name the docs to read, let me
  write the code, then review it. Boilerplate and generated code you may write.
- A task is finished when its "Done when" holds and CI is green. Then tick it
  here, update Progress in `CLAUDE.md`, and suggest the commit message.
- End each task with two or three quick questions.
- Next.js 16 differs from older material: check `web/node_modules/next/dist/docs/`
  before writing Next.js code (see `web/AGENTS.md`).
- Never invent a hardware figure or a kernel claim. Source it (NFR9) or label it
  as an approximation.

---

## Phase 0. Foundations (done)

- [x] **0.1 Repository foundation.** Licences, ignore files, plan, ADR template.
- [x] **0.2 FastAPI skeleton.** `GET /api/v1/health`, tests, ruff, strict pyright.
- [x] **0.3 Next.js skeleton.** Server component calls the health endpoint.
- [x] **0.4 Docker.** Dockerfiles for both, `docker-compose.yml`.
- [x] **0.5 CI.** API, web and compose jobs in `.github/workflows/ci.yml`.
- [x] **0.6 Prove it on GitHub.** Open a pull request from the phase 0 branch,
  get all three CI jobs green, merge to `main`. Turn on branch protection
  (CI green + one review).
  *Done when:* `main` contains phase 0 and CI is green on it.

## Built ahead: desktop lab (done, see ADR 0002 and 0003)

A simulated desktop at `/desktop`: use the computer and watch each step go
through user space, the kernel, the hardware and the network. Traced: starting
and shutting down (firmware, bootloader, kernel, systemd, DHCP, logind, ACPI),
logging in, launching an app (clone, copy-on-write, execve, the ELF loader,
ld.so, page faults), opening a file (the page cache hit or miss, NVMe, DMA),
typing (USB, HID, evdev, the compositor, Wayland), a web search, playing sound
and video (PipeWire, real-time scheduling, HD Audio), and copy and paste. It
was built in one go at my request, ahead of the phases it borrows from (ADR
0002), on one reference stack (ADR 0003). The engine and scenarios are in
`web/lib/xray/`, the machine view in `web/components/lab/` and the desktop in
`web/components/desktop/`.

Tasks to make it mine, any time after phase 1 starts:

- [ ] **L.1 Read the engine.** Walk through `engine.ts` and its tests, and
  explain how stepping back also rewinds the screen, and why a field a trace
  will change is locked until the trace ends. Add one test of your own.
  *Concepts:* reducers, pure functions, derived state.
  *Docs:* React "Extracting State Logic into a Reducer"; Vitest "Getting
  Started".
  *Done when:* you can explain `appsAt` and `machineAt` and your test passes.
- [ ] **L.2 A `curl http://example.com` scenario.** Plain HTTP from the
  terminal: no TLS, so the packet panel shows the request in the clear.
  *Concepts:* union types (a new `ScenarioRequest` kind), narrowing.
  *Done when:* the command plays in the terminal and the scenario tests pass.
- [ ] **L.3 A `ping` scenario.** ICMP echo through the same path. Check first
  how ping opens an ICMP socket without root (`ping_group_range` in
  `man 7 icmp`).
  *Done when:* the packet panel shows an IPv4 header with an ICMP payload.
- [ ] **L.4 Scenarios from YAML (FR12).** After task 1.5, move the lab's
  scenarios and node descriptions into `content/` and load them through the
  API.
  *Done when:* changing a step's text needs no TypeScript change.
- [ ] **L.5 Light theme (NFR4).** Together with task 6.1.
- [ ] **L.6 Read the camera.** Walk through `web/lib/hardware/camera.ts` and
  its tests: world and screen coordinates, zooming around the pointer, and why
  one SVG transform per frame keeps zooming smooth without re-rendering React.
  Add a test of your own (for example, that a drag never moves the camera
  outside the computer).
  *Concepts:* coordinate transforms, pure functions, refs versus state.
  *Docs:* MDN "transform" (SVG attribute); React "Referencing Values with Refs".
  *Done when:* you can derive `zoomAround`'s formula on paper and your test
  passes.

### Hardware view (in progress, see ADR 0004)

A Hardware tab next to the lab's software map. You zoom from the whole
computer into the CPU, a core and, later, the data path; the parts and wires
the current step uses light up, in step with the timeline. It is built in five
phases, each one reviewed before the next:

- [x] **H.1 Model and camera.** The hierarchy as data (`web/lib/hardware/`),
  zoom, pan, click to fly in, keyboard, level of detail, breadcrumb, one
  playhead shared by every view, and a timeline you can drag. Plain boxes.
- [x] **H.2 Machine and CPU drawings.** The motherboard and CPU package drawn
  as hardware, with hover cards. Also: "Show in Hardware" from a box's
  details, and the frame-rate work in
  [ADR 0005](adr/0005-draw-the-hardware-in-code-and-keep-zooming-cheap.md).
- [ ] **H.3 Core and data path.** The core's units and the data path below
  them, with each step's events animated at every level.
- [ ] **H.4 RAM, SSD and network controller.** DIMM chips and banks, the
  SSD's controller and flash, the NIC's DMA rings.
- [ ] **H.5 Timeline sync and polish.** Following the signal across levels,
  touch, and a 60 fps check on a mid-range laptop.

Tasks 2.3, 3.4 and 3.5 below assumed React Flow for the zoomable map; re-plan
them against this view before phase 2 starts (ADR 0004).

## Phase 1. Content and catalog API (backend, familiar ground)

- [ ] **1.1 Pydantic models for content.** `Component` (id, name, parent,
  `layer: Literal["user","kernel","hardware"]`, kind, summary, why, specs,
  source, references, expandable), `Level` (connections, placement hints),
  `Scenario` (steps with at, to, view, latency_ns, note).
  *Concepts:* BaseModel, Field, Literal, `extra="forbid"`, aliases (`from` is a
  Python keyword), field validators.
  *Docs:* Pydantic "Models", "Fields", "Validators".
  *Done when:* unit tests accept valid examples and reject bad ones with clear
  messages.
- [ ] **1.2 YAML loader.** Walk `content/`, parse each file, validate it, and
  collect every error with its file path, so one run reports all problems.
  *Concepts:* pathlib, separating I/O from validation, aggregating errors.
  *Done when:* a broken fixture file produces an error naming file and field.
- [ ] **1.3 Cross-file checks.** Unique ids, parents exist, connections and
  scenario steps point at real components, every latency figure has a source
  or an `approx` flag (NFR9).
  *Concepts:* building an index, `model_validator(mode="after")`.
  *Done when:* each rule has a failing-fixture test.
- [ ] **1.4 Load at startup, fail fast (FR11).** Load the catalog in a FastAPI
  lifespan, keep it on `app.state`, expose it through a dependency
  (`Annotated[Catalog, Depends(get_catalog)]`). Content path from an env var.
  *Docs:* FastAPI "Lifespan Events", "Dependencies".
  *Done when:* the API refuses to start on invalid content and prints why.
- [ ] **1.5 Catalog endpoints (FR10).** `GET /components`, `/components/{id}`,
  `/levels/{id}` (children plus connections), `/scenarios`, `/scenarios/{id}`,
  all under `/api/v1`, with 404s.
  *Docs:* FastAPI "Testing Dependencies with Overrides".
  *Done when:* tests run against a small fixture content dir, not the real one;
  NFR5 (catalog under 100 ms) checked once.
- [ ] **1.6 Write the MVP content.** Port every part from
  `docs/prototype/index.html` into YAML: components, levels (with hand placed
  coordinates for hardware levels), and the two scenarios.
  Decide and record in an ADR: which kernel release to pin and which
  filesystem the trace uses. Then pin the kernel paths in the desktop lab too.
  *Done when:* the real content loads, and every figure is sourced or labelled.
- [ ] **1.7 Content in CI and for contributors (FR12).** A `validate` command
  that CI runs on `content/`; a first draft of CONTRIBUTING.md's content track.
  *Done when:* a pull request with a bad YAML file fails CI with a readable
  message.

## Phase 2. Static machine view (first frontend phase)

- [ ] **2.1 Generated API types.** `openapi-typescript` turns
  `/api/v1/openapi.json` into `web/lib/api/schema.d.ts`; a `pnpm gen:api`
  script; CI fails if the file is stale. One source of truth: YAML, Pydantic,
  OpenAPI, TypeScript.
  *Done when:* changing a Pydantic field breaks `pnpm typecheck` until
  regenerated.
- [ ] **2.2 TypeScript and React basics.** Render the System level as a plain
  list from the API in a server component.
  *Concepts:* types vs interfaces, unions, narrowing, props, `map` and `key`.
  *Docs:* React "Thinking in React"; Next.js "Server and Client Components".
  *Done when:* every System component appears, typed end to end.
- [ ] **2.3 React Flow canvas.** A client component (`"use client"`) that turns
  a level into nodes and edges at their hand placed positions.
  *Concepts:* the server/client boundary, passing serializable props.
  *Docs:* React Flow "Quickstart", "Custom Nodes".
  *Done when:* the System level renders as a pannable, zoomable canvas.
- [ ] **2.4 SVG part library.** Reusable components ported from the prototype:
  Chip, Dimm, M2Stick, CpuSocket, Heatsink, SramBlock, LogicBlock, Terminal.
  Custom node types pick the art by component kind.
  *Concepts:* component composition, props with defaults, SVG in JSX.
  *Done when:* the System level looks like the prototype's motherboard.
- [ ] **2.5 Layers visible (FR13).** Software strip for user and kernel, layer
  colours as design tokens in Tailwind's theme (the desktop lab already
  defines them in `app/globals.css`; reuse them).
  *Done when:* user, kernel and hardware are distinct at a glance.
- [ ] **2.6 Accessibility baseline (NFR3).** Nodes are focusable with labels;
  Enter selects; visible focus ring.
  *Done when:* the System level can be explored by keyboard alone.

## Phase 3. Drill down

- [ ] **3.1 Dynamic route `/explore/[...path]` (FR2, FR4).** Map URL segments
  to level ids; `notFound()` for unknown paths; `generateMetadata` for titles.
  *Docs:* Next.js "Dynamic Routes" (check the bundled docs: `params` is async).
  *Done when:* `/explore/cpu/core` opens the core level directly.
- [ ] **3.2 Layout and breadcrumb (FR3).** A shared layout with the breadcrumb;
  `<Link>` navigation; Escape goes up one level.
  *Docs:* Next.js "Layouts and Pages", "Linking and Navigating".
  *Done when:* any parent is one click away and the back button works.
- [ ] **3.3 Inspector and client state (FR5).** A Zustand store for the selected
  component; the inspector fetches details with TanStack Query and the
  generated types.
  *Concepts:* useState vs a store, caching on the client.
  *Done when:* selecting a part shows its summary, why, figures and sources.
- [ ] **3.4 Kernel level with ELK.** Auto layout for software levels; run it
  once per level and memoize.
  *Concepts:* async work in effects, `useMemo`.
  *Done when:* the kernel level lays itself out without hand coordinates.
- [ ] **3.5 Zoom transition, loading and error states.** Motion for the zoom,
  honouring reduced motion; `loading.tsx` and `error.tsx`.
  *Done when:* drilling in and out animates, and is instant with reduced motion.
- [ ] **3.6 End to end test.** Playwright in CI: open a deep link, drill in,
  go back.
  *Done when:* the test runs in CI against the compose stack.

## Phase 4. Trace playback

- [ ] **4.0 Decide where traces run.** Server-computed traces vs steps sent
  once and animated on the client (open decision; the desktop lab animates on
  the client, see ADR 0002). Record it in an ADR.
- [ ] **4.1 Scenario pages (FR6).** `/scenarios` list and `/scenarios/[id]`.
- [ ] **4.2 `usePlayback` hook.** Play, pause, step forward and back, reset;
  timers cleaned up in effects; unit tests with Vitest (already set up; the
  desktop lab's `web/lib/xray/engine.ts` is a reference reducer).
  *Docs:* React "Reusing Logic with Custom Hooks", "Synchronizing with Effects".
  *Done when:* the hook's tests cover every control.
- [ ] **4.3 Highlight and signal (FR7).** Active part glows, the active path
  animates with a moving dot, cumulative latency shows sourced figures and
  counts unsourced steps (NFR9).
- [ ] **4.4 Follow the trace across levels (FR8).** When a step lives on
  another level, navigate there and keep playback state across routes.
  *Done when:* scenario 2 plays from user space to the SSD and back.
- [ ] **4.5 Performance check (NFR1).** Profile with React DevTools; memoize
  nodes; hold 60 fps at 40 nodes.

## Phase 5. Cache playground

- [ ] **5.1 Cache simulator in pure Python.** Address split into tag, index and
  offset; set associativity; LRU and FIFO; tests against hand calculated
  examples.
- [ ] **5.2 `POST /api/v1/simulate/cache` (FR9).** Request validation (powers of
  two, at most 10,000 accesses), response with per-access hit or miss; NFR5
  timing test (under 500 ms).
- [ ] **5.3 Playground form.** Inputs for size, line size, associativity,
  policy and access pattern; show the API's 422 messages next to fields.
- [ ] **5.4 Cache visual.** Sets and ways drawn as an SRAM grid; accesses
  stream through with hits and misses marked.

## Phase 6. Polish and launch

- [ ] **6.1 Light and dark themes (NFR4).**
- [ ] **6.2 Accessibility pass (NFR3).** axe checks, keyboard walk-through,
  text alternatives for every part.
- [ ] **6.3 Mobile and touch (NFR10).** Usable from 375 px.
- [ ] **6.4 Performance (NFR2).** Lighthouse 90+ on the landing page.
- [ ] **6.5 Deploy.** Web on Vercel, API as a container; env config and CORS
  for the real origins.
- [ ] **6.6 Open source launch.** CONTRIBUTING (content and code tracks),
  CODE_OF_CONDUCT, issue templates (bug, new component, new scenario, factual
  correction), labels, release-please, README GIF, tag v0.1.
