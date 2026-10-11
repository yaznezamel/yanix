# marks: a C program to watch from the inside

`marks.c` asks for students' names and marks, keeps them in memory, and prints
everyone's average. The program itself is ordinary; it is written to show
where data lives while a C program runs:

| In the code | Where it lives | Why |
|---|---|---|
| `char line[64]` | main()'s stack frame | A local array: its size is known when the program is compiled |
| `struct student s` | main()'s stack frame | A local struct: a pointer and three `int`s |
| `struct student *students` | main()'s stack frame | The pointer is local; what it points to is not |
| `strdup(line)` | the heap | A copy of the name, sized at run time |
| `realloc(students, …)` | the heap | The array grows by one student, and may move to do so |
| `read_marks()`, `average()` | their own frames, below main()'s | Each call gets a frame; returning gives it back |

The [Yanix desktop lab](../../web/README.md) runs this program in its
terminal: type `./marks`, then your name and marks, and follow each step from
the keyboard through the kernel to the CPU's caches and RAM. The lab's Memory
tab shows the stack and the heap changing as you type. What it shows was
measured from this program (see "How the lab's numbers were measured"), and
[ADR 0006](../../docs/adr/0006-model-a-real-c-program-from-measurements.md)
explains why the lab models it rather than running it.

## Build and run

On any Linux machine with a C compiler:

```sh
make
./marks
```

```
Student name: Yazn
Marks for Yazn (3 numbers, 0 to 100): 72 85 90
Add another student? (y/n) n
Yazn          72  85  90   average  82.3
```

## Watch it for real

**System calls.** `strace` lists every request the program makes to the kernel:

```sh
strace -e trace=brk,read,write,exit_group ./marks
```

Look for these:

- A single `brk()` pair, the first time `printf()` runs. glibc's `malloc()` needs a heap for stdout's
  buffer, so it asks the kernel to move the end of the heap: 132 KiB at once
  (0x21000 bytes; glibc pads each request to grow the heap by `M_TOP_PAD`, 128 KiB by
  default, see `mallopt(3)`). `strdup()` and `realloc()` never call the kernel
  after that: the heap has room.
- `write(1, "Student name: ", 14)` comes just before each `read(0, …)`. stdout
  is line-buffered on a terminal, and reading stdin flushes it, so the prompt
  appears before the program waits.
- One `read()` per line you type: the terminal's line discipline holds the
  characters until you press Enter.

**The memory map.** While the program waits for input, in another terminal:

```sh
cat /proc/$(pidof marks)/maps
```

`[heap]` appears only after the first `printf()`; `[stack]` is at the top of the
address space. Run it twice and the addresses change: that is ASLR, address
space layout randomisation.

**Stack and heap with gdb.**

```sh
gdb -q ./marks
(gdb) break read_marks
(gdb) run
(gdb) info frame            # read_marks()'s frame, below main()'s
(gdb) up
(gdb) print &line           # an address in the stack
(gdb) print s.name          # an address in the heap
(gdb) x/24xb &s             # the struct's bytes: a pointer, then three ints
```

gdb turns ASLR off, so you see the same addresses on every run.

## How the lab's numbers were measured

With GCC 13.3 and glibc 2.39 (Ubuntu 24.04) on x86-64, built by this Makefile,
running on a pseudo-terminal:

- **main()'s frame.** It is 160 bytes, from `rbp` down to `rsp`. `line` is at
  `rbp-0x50`, `s` at `rbp-0x70`, `grown` at `rbp-0x78`, `count` at `rbp-0x90`,
  `students` at `rbp-0x98` and `got` at `rbp-0x9c`. The two loop counters are at
  `rbp-0x80` and `rbp-0x88`. The stack canary is at `rbp-0x8`, with the saved
  `rbp` and the return address above it.
- **read_marks()'s frame.** It is 48 bytes. `average()` calls no other
  function, so the compiler leaves `rsp` where it is and keeps its locals in
  the red zone below it.
- **The heap.** It starts with three blocks glibc makes for itself: the
  thread's cache of free blocks (tcache, 0x290 bytes), stdout's buffer and
  stdin's buffer (0x410 each: 1024 bytes, the terminal's block size, plus a
  header). Each name and the students array come after them, in 16-byte steps
  of at least 32 bytes.

Another compiler, other flags or another C library lay memory out differently;
the ideas stay the same.

`test.sh` builds the program with warnings as errors, types in the same
students and checks what it prints; CI runs it on every pull request.
