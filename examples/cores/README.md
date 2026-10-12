# cores: a C program that uses several cores at once

`cores.c` fills an array with a million marks, then asks how many threads to
use. Each thread adds up its own slice of the array, and the kernel runs the
threads on different cores at the same time. `main()` waits for them, adds up
their results and prints the average.

The threads of a process share almost everything, and each has a little of its
own:

| In the code | Where it lives | Shared? |
|---|---|---|
| `int *marks` (4 MB) | a mapping of its own: too big for the heap, so `malloc()` asks the kernel with `mmap()` | by every thread |
| `struct slice slices[4]` | `main()`'s stack frame | each thread gets a pointer to its own slice |
| `long sum`, `size_t i` in `add_up()` | the thread's own stack: 8 MiB that `pthread_create()` maps for it | no |
| registers, the instruction pointer | the core running the thread | no |
| the program's code, the C library | mapped once for the process | yes |

The [Yanix desktop lab](../../web/README.md) runs this program in its
terminal: type `./cores`, then a number of threads, and watch the scheduler
place them on the CPU's cores and all four cores work at once. The lab's Memory
tab shows the threads, their stacks and what each core runs at every step.
What it shows was measured from this program (see "How the lab's numbers were
measured").

## Build and run

On any Linux machine with a C compiler:

```sh
make
./cores
```

```
How many threads (1 to 4, 0 to stop)? 4
thread 1: marks 0 to 249999 add up to 12499050 (finished on CPU 0)
thread 2: marks 250000 to 499999 add up to 12499675 (finished on CPU 2)
thread 3: marks 500000 to 749999 add up to 12500300 (finished on CPU 3)
thread 4: marks 750000 to 999999 add up to 12500925 (finished on CPU 1)
average of 1000000 marks: 49.99995
How many threads (1 to 4, 0 to stop)? 0
```

The sums never change. The CPU numbers do: the scheduler decides where each
thread runs, and it may move a thread while it runs.

## Watch it for real

**Pin it to one core.** `taskset -c 0 ./cores` lets the process use CPU 0
only: every thread then finishes on CPU 0, taking turns rather than running
at the same time.

**System calls.** `strace -f` follows every thread:

```sh
strace -f -e trace=mmap,mprotect,clone3,futex,madvise,munmap,exit ./cores
```

Look for these:

- `mmap(NULL, 4001792, …)` before the first prompt: the array. 4,000,000 bytes
  plus `malloc()`'s 16-byte header, rounded up to whole pages: 977 of them.
- For each thread: `mmap(NULL, 8392704, PROT_NONE, …, MAP_STACK, …)` and
  `mprotect(…, 8388608, PROT_READ|PROT_WRITE)`, an 8 MiB stack (the size
  `ulimit -s` gives) with one page left inaccessible below it as a guard. Then
  `clone3({flags=CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD|…})`:
  a new task that shares the process's memory, files and signal handlers.
- `futex(…, FUTEX_WAIT_BITSET…)` from `main()`: `pthread_join()` sleeping until
  the thread has exited. A thread ends with `madvise(…, MADV_DONTNEED)`, which
  gives back the RAM of the stack it no longer needs, and `exit(0)`, which ends
  that thread only.
- Ask for threads a second time: no `mmap()` for the stacks. glibc keeps the
  stacks of finished threads and hands them to new ones, newest first.
- `munmap(…, 4001792)` after you type 0: `free()` hands a mapped chunk straight
  back to the kernel, unlike the small chunks of [`../marks`](../marks/).

**The threads.** While the program waits for input, `ls /proc/$(pidof cores)/task`
lists its threads (only `main()`'s, between rounds); `ps -eLf` and `top -H`
show threads too. `cat /proc/$(pidof cores)/maps` shows the stacks next to the
array: the guard pages are the `---p` lines.

**gdb.**

```sh
gdb -q ./cores
(gdb) break add_up
(gdb) run
(gdb) info threads          # main() and the threads, each with its own stack
(gdb) thread apply all bt   # what every thread is doing
```

## How the lab's numbers were measured

With GCC 13.3 and glibc 2.39 (Ubuntu 24.04) on a 4-core x86-64 machine, built
by this Makefile, running on a pseudo-terminal:

- **main()'s frame** is 320 bytes. `line` is at `rbp-0x20`, `slices` at
  `rbp-0xc0` (40 bytes each), `ids` at `rbp-0xe0`, `threads` at `rbp-0x110`,
  `per` at `rbp-0x118`, `marks` at `rbp-0x120` and `total` at `rbp-0x128`. The
  canary is at `rbp-0x8`.
- **add_up()'s frame** is 48 bytes: `slice` at `rbp-0x8`, `i` at `rbp-0x10`,
  `sum` at `rbp-0x18`. Its `rbp` is 0x1140 bytes below the top of the thread's
  stack mapping; glibc keeps the thread's descriptor and its thread-local
  storage at the very top.
- **Mappings.** The array sits just below the C library, and each new thread's
  stack mapping (8 MiB plus a 4 KiB guard page) below the one before.
- **Page faults.** Filling the array cost about 974 more page faults than not
  filling it: one per page the loop is first to write.
- **Time.** Creating a thread took tens of microseconds. Creating, running and
  joining the threads took about 2.7 to 3.3 ms with 1 thread, 1.4 to 1.7 ms
  with 2 and 0.9 to 1.2 ms with 4 (measured with `clock_gettime()` around
  them, in a copy of the program). Four threads were about three times faster,
  not four: starting threads costs time, and all the cores share one memory
  controller and the same RAM.

Another machine, compiler or C library gives other numbers; the ideas stay the
same.

`test.sh` builds the program with warnings as errors and checks its sums for
1, 2 and 4 threads; CI runs it on every pull request.
