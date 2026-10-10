# Yanix

Zoom into a computer, from a syscall down to silicon, and watch one request
travel through the Linux kernel and the hardware underneath it.

> Status: early development (phase 0, foundations). Nothing runs yet.

## What it will be

- **A zoomable map.** Start at the whole machine (a process, the Linux kernel,
  CPU, RAM, SSD) and click into the kernel's subsystems, or into the CPU and
  then a core, C4 style.
- **Traced scenarios.** Pick "`read()` 4 KB from a file", press play, and watch
  each hop light up (syscall, VFS, page cache miss, block layer, NVMe driver,
  DMA, interrupt, wake up, copy to user) with a running latency counter.

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
