# Yanix

Zoom into a computer, from a syscall down to silicon, and watch one request
travel through the Linux kernel and the hardware underneath it.

> Status: early development. Phase 0 (foundations) is in place, plus a desktop
> lab built ahead of the roadmap. Phase 1 (content and catalog API) is next.

## Try the desktop lab

Open http://localhost:3000/desktop after the quick start below. It is a
simulated Linux desktop, and everything you do on it is traced from user space
through the kernel and the hardware:

- **Start and stop it:** shut down or restart from the Start menu, then press
  the power button: firmware, bootloader, kernel, systemd, DHCP, login.
- **Launch an app:** clone, copy-on-write, execve, the ELF loader, the dynamic
  linker and the page faults that pull code in.
- **Open a file:** open() and read(), the VFS and the page cache. The first read
  misses and goes to the SSD; the second hits RAM.
- **Type:** one key from the keyboard's USB report through an interrupt, the
  HID driver, evdev and the compositor to the app, as a Wayland message.
- **Search the web:** DNS, ARP, NAT, TCP, TLS and HTTP/2, packet by packet.
- **Play sound or video:** PipeWire's real-time thread, the ring buffer, DMA
  and the speakers; frames flipped at the display's refresh.
- **Copy and paste:** the compositor brokers it; the text moves through a pipe
  only when you paste.
- **Run a C program:** type `./marks` in the Terminal and answer its questions
  (a name, three marks). Each line you type is traced through the TTY, the C
  library, the kernel and the CPU, and the **Memory** tab shows the program's
  stack frames and heap chunks changing: `strdup()` copying a name to the
  heap, `realloc()` moving the array, the first `brk()` and page fault. The
  program is [`examples/marks/marks.c`](examples/marks/), which you can build
  and watch for real with strace and gdb.
- **Use every core:** type `./cores` and a number of threads (1 to 4). Each
  thread gets a stack of its own and a `clone3()`, the scheduler places it on
  a core, and the Hardware tab lights all four cores at once while they add up
  a shared array; `main()` sleeps in `pthread_join()` until each one exits.
  The program is [`examples/cores/cores.c`](examples/cores/).

Pause, step, replay, or drag the timeline to any point. Switch between an
overview and a deep dive. Caches stay warm between runs, so a second read,
launch or search does less work.

Each step's route is numbered on the map and lit stop by stop. The story says
how much data the step moves (a DNS query in a 75-byte frame, a 1,541-byte
TLS ClientHello, 8 KiB of sound every 21 ms) and, where it fits, where AWS does
the same thing: the VPC's DNS resolver, NAT gateways, load balancers, EBS,
Nitro. Software is drawn as glass over the hardware it runs on, and every
figure has a source
([ADR 0008](docs/adr/0008-number-the-route-draw-software-as-glass-and-source-every-figure.md)).

Next to the software path, the **Hardware** tab shows the same trace on the
machine itself: zoom from the motherboard into the CPU (its lid comes off as
you go) and one of its cores, and watch the parts and wires each step uses
light up. Rest the pointer on a part to learn what it does, or open a box of
the software path and choose **Show in Hardware** to see where it runs. It is
a generic, illustrative PC
([ADR 0004](docs/adr/0004-draw-the-hardware-view-as-svg-with-its-own-camera.md),
[ADR 0005](docs/adr/0005-draw-the-hardware-in-code-and-keep-zooming-cheap.md)).

It is a teaching model with scripted steps, not a live trace (see
[ADR 0002](docs/adr/0002-build-a-desktop-lab-ahead-of-the-roadmap.md) and
[ADR 0003](docs/adr/0003-model-one-desktop-linux-stack.md)). The C programs'
memory is modelled from measurements of the real programs, and tests check the
model against them
([ADR 0006](docs/adr/0006-model-a-real-c-program-from-measurements.md)); which
core runs which thread is the lab's simple model of the scheduler
([ADR 0007](docs/adr/0007-model-threads-on-cores-and-say-what-is-modelled.md)).

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
