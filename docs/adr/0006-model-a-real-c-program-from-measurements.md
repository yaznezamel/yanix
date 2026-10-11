# 0006. Model a real C program from measurements, and show its memory in a tab

- Status: accepted
- Date: 2026-10-11

## Context

The lab traces what the desktop does, but never what a program does with its
own memory. A student learning C wants to see the stack and the heap change
while a program runs: a local array filling up, `strdup()` copying a string to
the heap, `realloc()` growing or moving an array, a function's frame coming and
going. The request was a C program with names, marks, an array, the stack and
the heap, run in the lab and traced down to the kernel and the hardware.

The lab is a teaching model with scripted traces, not a live tracer (ADR 0001,
ADR 0002), and every figure must have a source (NFR9). The program must run
on phones too (NFR10), and its traces must scrub back and forth like the others.

## Options considered

1. **Compile the program to WebAssembly and run it in the browser.** Real
   execution, but in WebAssembly's memory model: one linear memory, no brk(),
   no page faults, another malloc(), and no x86-64 stack frames. Everything the
   lab would show about the kernel and the CPU would be false for that run.
2. **Run Linux in the browser (an x86 emulator).** Real, but tens of megabytes
   to load, slow on a phone, and still blind: showing chunks and frames would
   need a debugger inside the emulator.
3. **Model the program, and check the model against the real one.** Write the
   program (`examples/marks/marks.c`), build it, and measure it with strace
   and gdb: every system call, the frame offsets, every chunk. Then model what
   it does in TypeScript: glibc's malloc() as this program drives it (the
   tcache, the top chunk, brk()), and its stack frames from the measured
   offsets. Tests replay the measured session and must give the same layout.

## Decision

Option 3. `examples/marks/` holds the program, a Makefile, and a README that
shows how to watch it for real; CI builds it with warnings as errors and checks
its output. `web/lib/xray/marks/` models it: `heap.ts` follows glibc 2.39's
malloc.c, `layout.ts` holds what gdb measured (GCC 13.3, x86-64) and three
address layouts from real runs (ASLR), and `program.ts` the C semantics it
needs, such as what fgets() writes and how sscanf() parses. `./marks` in the
terminal starts it; each line you type is a trace from the keyboard through
the TTY, the C library, the kernel and the CPU. Every step carries a copy of
the program's state, so scrubbing rewinds the memory too.

The memory gets a third tab next to Software path and Hardware, not a window
on the simulated desktop: at the desktop's scale a debugger's worth of rows
would be unreadable, and the screen should show what the user sees. Steps name
the core's units they use (registers, execution units, TLB, L1 data cache),
which the hardware view lights; the core's other units stay as they are, since
every instruction goes through some of them.

## Consequences

- The memory shown is exact for this program on that compiler, those flags
  and glibc 2.39 on x86-64; another C library or compiler lays memory out
  differently. The tab says so, and so does the program's README.
- A newer glibc may change the numbers (its tcache keeps changing); the tests
  pin the measured layout, so a change to the model must match a new
  measurement.
- The lab caps a typed line at 62 bytes, so one fgets() call reads it whole;
  the real program would split a longer line across two calls.
- First use of the core's units in traces, ahead of phase H.3; H.3 should
  build its data path on `Step.parts`.
- Revisit when content moves to YAML (FR12): the program's traces are code,
  since they are computed from the model rather than written out.
