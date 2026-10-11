// Where marks.c's data lives, as measured on the real program (GCC 13.3,
// glibc 2.39, x86-64, built by examples/marks/Makefile, on a pseudo-terminal):
// frame offsets from gdb, and the address-space layouts of three runs with
// ASLR on. examples/marks/README.md says how to see them yourself.

/** One run's addresses: ASLR picks new ones every time the program starts. */
export interface Layout {
  /** Start of the program's own mapping (the ELF file, position-independent). */
  exe: number;
  /** Start of the heap: the program break before the first malloc(). */
  heap: number;
  libc: number;
  /** The dynamic linker, ld-linux-x86-64.so.2. */
  ld: number;
  /** The [stack] mapping, start and end. */
  stack: [number, number];
  /** main()'s frame pointer, rbp. */
  rbp: number;
}

export const LAYOUTS: Layout[] = [
  {
    exe: 0x55daaca58000,
    heap: 0x55dae3576000,
    libc: 0x7f4df1800000,
    ld: 0x7f4df1a9f000,
    stack: [0x7ffc81ed8000, 0x7ffc81efb000],
    rbp: 0x7ffc81ef7e90,
  },
  {
    exe: 0x55a8c15b5000,
    heap: 0x55a8cd242000,
    libc: 0x7f1966800000,
    ld: 0x7f1966a5f000,
    stack: [0x7ffc0f578000, 0x7ffc0f59b000],
    rbp: 0x7ffc0f5972b0,
  },
  {
    exe: 0x55789e111000,
    heap: 0x5578ab37e000,
    libc: 0x7f3000a00000,
    ld: 0x7f3000d12000,
    stack: [0x7ffc8b4c0000, 0x7ffc8b4e3000],
    rbp: 0x7ffc8b4de790,
  },
];

export function layoutOf(run: number): Layout {
  return LAYOUTS[run % LAYOUTS.length]!;
}

/** Sizes of the mappings that are the same on every run (from /proc/PID/maps). */
export const MAPPED = {
  exe: 0x5000,
  libc: 0x206000,
  ld: 0x3a000,
} as const;

/** main()'s frame: 160 bytes from rbp down to rsp (sub rsp, 0xa0). Offsets are from rbp. */
export const MAIN = {
  size: 0xa0,
  ret: 0x8,
  savedRbp: 0x0,
  canary: -0x8,
  line: -0x50,
  s: -0x70,
  grown: -0x78,
  printI: -0x80,
  freeI: -0x88,
  count: -0x90,
  students: -0x98,
  got: -0x9c,
} as const;

/**
 * read_marks()'s frame: 48 bytes below its rbp, which sits just under the
 * return address and main()'s saved rbp. average() calls nothing, so it never
 * moves rsp and keeps its locals in the red zone under it, at the same rbp.
 */
export const CALLEE = {
  /** The callee's rbp, below main()'s. */
  rbp: -(MAIN.size + 0x10),
  readMarks: { size: 0x30, line: -0x18, lineSize: -0x1c, marks: -0x28, i: -0x4 },
  average: { size: 0, marks: -0x18, n: -0x1c, sum: -0x8, i: -0x4 },
} as const;

/** Return addresses: offsets into the program and into libc.so.6 for this build. */
export const RETURNS = {
  /** In main(), after the call to read_marks(). */
  readMarks: 0x143f,
  /** In main(), after the call to average(). */
  average: 0x1590,
  /** In libc's __libc_start_call_main(), after it called main(). */
  main: 0x2a1ca,
} as const;

/** The size of struct student: an 8-byte pointer, three 4-byte ints, 4 bytes of padding. */
export const STUDENT_SIZE = 24;

/** st_blksize of a pseudo-terminal: glibc sizes stdin's and stdout's buffers by it. */
export const TTY_BLOCK = 1024;

/** An address as gdb prints it. */
export function hex(n: number): string {
  return `0x${n.toString(16)}`;
}
