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

## Phase 0. Foundations (done, except 0.6)

- [x] **0.1 Repository foundation.** Licences, ignore files, plan, ADR template.
- [x] **0.2 FastAPI skeleton.** `GET /api/v1/health`, tests, ruff, strict pyright.
- [x] **0.3 Next.js skeleton.** Server component calls the health endpoint.
- [x] **0.4 Docker.** Dockerfiles for both, `docker-compose.yml`.
- [x] **0.5 CI.** API, web and compose jobs in `.github/workflows/ci.yml`.
- [ ] **0.6 Prove it on GitHub.** Open a pull request from the phase 0 branch,
  get all three CI jobs green, merge to `main`. Turn on branch protection
  (CI green + one review).
  *Done when:* `main` contains phase 0 and CI is green on it.

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
  Decide and record: which kernel release to pin (ADR 0002) and which
  filesystem the trace uses.
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
  colours as design tokens in Tailwind's theme.
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
  once and animated on the client (open decision). Write ADR 0003.
- [ ] **4.1 Scenario pages (FR6).** `/scenarios` list and `/scenarios/[id]`.
- [ ] **4.2 `usePlayback` hook.** Play, pause, step forward and back, reset;
  timers cleaned up in effects; unit tests with Vitest.
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
