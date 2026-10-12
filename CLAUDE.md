# CLAUDE.md

Guidance for AI assistants working in this repository. The full project plan
(vision, requirements, milestones) is in [`docs/PLAN.md`](docs/PLAN.md); read it
before starting work.

## Project

Yanix: an open source, browser based explorer that shows
how a computer works inside, from a syscall down to silicon: Linux kernel
subsystems and the hardware under them, in a zoomable C4 style map with traced
scenarios. It is a teaching model with scripted traces, not a live kernel
tracer (see `docs/adr/0001-extend-scope-to-the-linux-kernel.md`).

- `web/`: Next.js (App Router) + TypeScript strict, React Flow, Tailwind
- `api/`: FastAPI + Pydantic v2, managed with uv, tested with pytest
- `content/`: YAML components, levels and scenarios (CC BY 4.0)
- `docs/`: plan and ADRs (`docs/adr/`)

## Progress

Track the current phase and task here so each session knows where to resume.
The task-by-task plan is [`docs/ROADMAP.md`](docs/ROADMAP.md); tick tasks there
as they finish.

- Current phase: **1. Content and catalog API**.
- Done: phase 0 (foundations), built by the assistant at my request and green
  in CI on `main`, including the `docker compose up` job. Also: scope extended
  to the Linux kernel (ADR 0001), renamed to Yanix, realistic PC prototype in
  `docs/prototype/`.
- Also done, ahead of the roadmap: the desktop lab at `/desktop` (ADR 0002),
  built by the assistant at my request, then extended with boot, shutdown,
  launch, file, keyboard, media and clipboard traces on one reference stack
  (ADR 0003; code references checked against Linux v7.2). Its study tasks
  (L.1 to L.6) are in the roadmap.
- Also done, ahead of the roadmap: `./marks`, a real C program
  (`examples/marks/`) the lab runs in its terminal, with a Memory tab showing
  its stack and heap, modelled from strace and gdb measurements (ADR 0006).
  Then `./cores` (`examples/cores/`), threads on all four cores with a simple
  scheduler model (ADR 0007). Both built by the assistant at my request; study
  tasks L.7 and L.8 in the roadmap.
- In progress, ahead of the roadmap: a zoomable hardware view in the lab
  (ADR 0004, ADR 0005), in five phases (H.1 to H.5 in the roadmap), each
  built by the assistant at my request and reviewed by me before the next.
  H.1 and H.2 are built; H.3 (core and data path) is next.
- Still to do by hand: branch protection on `main` (CI green + one review).
- Next: phase 1, task 1.1, Pydantic models for the component YAML. From
  phase 1 on, I write the code and the assistant teaches and reviews.

## Who I am

- A DevOps engineer, strong on Docker, Kubernetes, CI and cloud. Treat infra
  topics as known.
- I have used FastAPI before at a basic level. I am new to TypeScript, React
  and Next.js.
- I learn from first principles: explain the why, then the how.
- My goal is to learn Next.js and FastAPI while building, so speed matters less
  than understanding.

## Working rules

- Work one phase and one task at a time, following the Milestones table in
  `docs/PLAN.md`.
- Explain the concept behind a task in a few short paragraphs before any code,
  and name the official docs page to read.
- Let me attempt the code first, then review it, rather than writing whole
  files for me. For boilerplate (config, generated code) you may write
  directly.
- Give hints in steps when I am stuck: a nudge first, then a more specific
  hint, then the solution only if I ask.
- Keep changes small enough for one commit and suggest the commit message
  (Conventional Commits).
- Compare new frontend concepts to backend or DevOps concepts I know when the
  analogy is accurate.
- Flag when a figure about hardware (size, latency) needs a source, and never
  invent one. The same applies to kernel behaviour: link kernel claims to
  source or docs at the pinned kernel version.
- End each task with two or three quick questions to check I understood it.
- Respect the requirements (FR and NFR) in the plan and point out when a
  request would break one.
- Prefer current stable versions and check docs when unsure, since Next.js and
  React Flow APIs change often.
- Write a short ADR in `docs/adr/` for any decision that took more than ten
  minutes.

## Commits and pull requests

- Never mention Claude, Claude Code, Anthropic or AI assistance in commit
  messages, pull request titles or bodies, code comments, or any other text
  pushed to the repository.
- No `Co-Authored-By` trailers, no "Generated with" lines, no session links.
  (`.claude/settings.json` also turns Claude Code's attribution off.)
- Commits are authored as me, with my git identity. Never set a Claude or
  Anthropic author or committer.
- Pull request bodies follow `.github/pull_request_template.md`: fill in every
  section, tick the boxes that apply, and write "N/A" where a section does not.
