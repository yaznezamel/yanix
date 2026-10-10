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

- Current phase: **0. Foundations**
- Done: 0.1 repository foundation (licences, ignore files, plan, ADR template);
  scope extended to the Linux kernel (ADR 0001)
- Next: 0.2 FastAPI skeleton with `/api/v1/health`

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
