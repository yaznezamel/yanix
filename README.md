# SiliconMap

Zoom into a computer, from the whole machine down to a cache line, and watch one
request travel through it.

> Status: early development (phase 0, foundations). Nothing runs yet.

## What it will be

- **A zoomable map.** Start at the whole PC (CPU, RAM, chipset, SSD) and click
  into the CPU, then into a core, C4 style.
- **Traced scenarios.** Pick "read 4 KB from a file", press play, and watch each
  hop light up (L1 miss, L2 miss, RAM, page fault, DMA, interrupt) with a running
  latency counter.

See [`docs/PLAN.md`](docs/PLAN.md) for the full plan, requirements and roadmap.

## Repository layout

| Path | What lives there |
|---|---|
| `web/` | Next.js frontend (coming in phase 0) |
| `api/` | FastAPI backend (coming in phase 0) |
| `content/` | YAML components, levels and scenarios |
| `docs/` | Plan and architecture decision records |

## Licence

Code is [MIT](LICENSE). Explanatory content in `content/` is
[CC BY 4.0](content/LICENSE).
