# 0007. Model threads on cores, and say which part is the model's

- Status: accepted
- Date: 2026-10-12

## Context

After `./marks` (ADR 0006), the next request was a program that shows
multi-core processing: code running on several cores at once, traced through
the kernel and the hardware. Until now every trace ran on core 0 of the
hardware view, by design.

Most of what a threaded program does can be measured, as for `./marks`: strace
shows each thread's stack mapping, `clone3()` with its flags, `futex()` in
`pthread_join()`, the stacks glibc reuses, and gdb shows every frame and
mapping. Where each thread runs cannot be measured in any way that would hold
for a student's machine: the scheduler decides, from load, caches and power,
and the real program prints a different CPU on almost every run. Timings vary
too (NFR9).

## Options considered

1. **Replay one measured run**, CPU numbers included. Exact for that run, but
   it presents one random outcome as the way it works.
2. **Leave placement out**: show the threads, not the cores. Honest, but it
   hides the point of the program, which is that the cores run at the same
   time.
3. **A simple scheduler model, labelled as such.** A new thread takes an idle
   core, the lowest numbered first, or waits in the run queue of `main()`'s
   core when every core is busy; a thread that wakes up gets its last core back
   if it is idle, else an idle one. Everything else (stacks, `clone3()`,
   futexes, the stack cache, the mappings) stays measured.

## Decision

Option 3. `examples/cores/cores.c` adds up a million marks with 1 to 4
threads; `web/lib/xray/cores/` models it, with the scheduler model in
`program.ts` and the measurements in `layout.ts`. The code says the placement
is the lab's model, the story says the scheduler decides, and the program's
own output, "finished on CPU n", shows students that real runs differ. The one
speed figure in the traces (4 threads took about a third of the time of 1) is
a measurement on a stated machine, in the program's README.

A step can now name the cores that run it (`Step.cores`); the hardware view
lights all of them and the units each one uses. The units of any running core
stay neutral unless the step names them, since every instruction uses some of
them (this generalises ADR 0006's rule for core 0).

Both programs share one box on the software map, "C program", and the steps
they have in common (starting, reading a line, writing a prompt, exiting) live
in `scenarios/program.ts`. The Memory tab shows whichever program ran last.

## Consequences

- With 4 threads, thread 4 waits for a core until `main()` sleeps in
  `pthread_join()`. A real scheduler might put it on another core and share
  that core's time instead; the story only claims that it waits its turn.
- Speed-ups are described, not animated: no step shows a duration beyond its
  order of magnitude.
- Revisit when phase H.3 animates the data path, which could show the loads of
  four cores contending for the memory controller.
