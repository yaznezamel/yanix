# Yanix

Zoom into a computer, from a syscall down to silicon, and watch one request
travel through the Linux kernel and the hardware underneath it.

> Status: early development. Phase 0 (foundations) is in place: a Next.js page
> that calls the FastAPI health endpoint.

## What it will be

- **A zoomable map.** Start at the whole machine (a process, the Linux kernel,
  CPU, RAM, SSD) and click into the kernel's subsystems, or into the CPU and
  then a core, C4 style.
- **Traced scenarios.** Pick "`read()` 4 KB from a file", press play, and watch
  each hop light up (syscall, VFS, page cache miss, block layer, NVMe driver,
  DMA, interrupt, wake up, copy to user) with a running latency counter.

See [`docs/PLAN.md`](docs/PLAN.md) for the full plan, requirements and roadmap,
and [`docs/prototype/index.html`](docs/prototype/index.html) for a clickable
prototype of the look (open it in a browser).

## Quick start

```sh
docker compose up --build
```

Then open http://localhost:3000. The page shows whether it can reach the API.
API docs are at http://localhost:8000/api/v1/docs.

Without Docker, run the two parts in separate terminals:

```sh
cd api && uv sync && uv run fastapi dev src/yanix/main.py
cd web && pnpm install && pnpm dev
```

## Repository layout

| Path | What lives there |
|---|---|
| `web/` | Next.js frontend ([README](web/README.md)) |
| `api/` | FastAPI backend ([README](api/README.md)) |
| `content/` | YAML components, levels and scenarios |
| `docs/` | Plan and architecture decision records |

## Licence

Code is [MIT](LICENSE). Explanatory content in `content/` is
[CC BY 4.0](content/LICENSE).
