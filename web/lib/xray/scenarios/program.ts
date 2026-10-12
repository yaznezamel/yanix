import { dataFrame, vma } from "../structs";
import type { CodeRef, Header, NodeId, Program, Step, TermLine } from "../types";
import { keysStep } from "./common";

// What the C programs the lab runs (./marks and ./cores) have in common: how
// a trace records the program's state step by step, how bash starts it, and
// how it reads a line from the terminal and writes a prompt back.

/** The box on the software map that stands for whichever C program runs. */
export const PROGRAM: NodeId = "program";

/** The units of core 0 a step's work uses (lib/hardware/hierarchy.ts). */
export function unitsOf(core: number, units: readonly ("regs" | "exec" | "tlb" | "l1d" | "l2")[]): string[] {
  return units.map((unit) => `cpu.core${core}.${unit}`);
}
/** Loads and stores: an address in registers, the TLB to translate it, the L1 data cache. */
export const MEMORY = unitsOf(0, ["regs", "exec", "tlb", "l1d"]);
/** Arithmetic and compares: registers and the execution units. */
export const ALU = unitsOf(0, ["regs", "exec"]);

export const CODE = {
  malloc: { project: "glibc", path: "malloc/malloc.c", symbol: "__libc_malloc" },
  tcacheInit: { project: "glibc", path: "malloc/malloc.c", symbol: "tcache_init" },
  sysmalloc: { project: "glibc", path: "malloc/malloc.c", symbol: "sysmalloc" },
  intMalloc: { project: "glibc", path: "malloc/malloc.c", symbol: "_int_malloc" },
  tcacheGet: { project: "glibc", path: "malloc/malloc.c", symbol: "tcache_get" },
  tcachePut: { project: "glibc", path: "malloc/malloc.c", symbol: "tcache_put" },
  realloc: { project: "glibc", path: "malloc/malloc.c", symbol: "_int_realloc" },
  free: { project: "glibc", path: "malloc/malloc.c", symbol: "__libc_free" },
  strdup: { project: "glibc", path: "string/strdup.c", symbol: "__strdup" },
  doallocate: { project: "glibc", path: "libio/filedoalloc.c", symbol: "_IO_file_doallocate" },
  underflow: { project: "glibc", path: "libio/fileops.c", symbol: "_IO_new_file_underflow" },
  fgets: { project: "glibc", path: "libio/iofgets.c", symbol: "_IO_fgets" },
  getline: { project: "glibc", path: "libio/iogetline.c", symbol: "_IO_getline" },
  sscanf: { project: "glibc", path: "stdio-common/isoc99_sscanf.c", symbol: "__isoc99_sscanf" },
  printf: { project: "glibc", path: "stdio-common/vfprintf-internal.c" },
  exit: { project: "glibc", path: "stdlib/exit.c", symbol: "exit" },
  startMain: { project: "glibc", path: "sysdeps/nptl/libc_start_call_main.h", symbol: "__libc_start_call_main" },
  brk: { project: "linux", path: "mm/mmap.c", symbol: "brk" },
  doBrk: { project: "linux", path: "mm/vma.c", symbol: "do_brk_flags" },
  fault: { project: "linux", path: "arch/x86/mm/fault.c", symbol: "exc_page_fault" },
  userFault: { project: "linux", path: "arch/x86/mm/fault.c", symbol: "do_user_addr_fault" },
  anonPage: { project: "linux", path: "mm/memory.c", symbol: "do_anonymous_page" },
  fstat: { project: "linux", path: "fs/stat.c", symbol: "vfs_fstat" },
  write: { project: "linux", path: "fs/read_write.c", symbol: "ksys_write" },
  read: { project: "linux", path: "fs/read_write.c", symbol: "ksys_read" },
  ttyWrite: { project: "linux", path: "drivers/tty/n_tty.c", symbol: "n_tty_write" },
  ttyRead: { project: "linux", path: "drivers/tty/n_tty.c", symbol: "n_tty_read" },
  canonCopy: { project: "linux", path: "drivers/tty/n_tty.c", symbol: "canon_copy_from_read_buf" },
  receive: { project: "linux", path: "drivers/tty/n_tty.c", symbol: "n_tty_receive_buf_common" },
  echo: { project: "linux", path: "drivers/tty/n_tty.c", symbol: "echo_char" },
  ptyWrite: { project: "linux", path: "drivers/tty/pty.c", symbol: "pty_write" },
  schedule: { project: "linux", path: "kernel/sched/core.c", symbol: "schedule" },
  wake: { project: "linux", path: "kernel/sched/core.c", symbol: "try_to_wake_up" },
  clone: { project: "linux", path: "kernel/fork.c", symbol: "kernel_clone" },
  execve: { project: "linux", path: "fs/exec.c", symbol: "do_execveat_common" },
  elf: { project: "linux", path: "fs/binfmt_elf.c", symbol: "load_elf_binary" },
  argPages: { project: "linux", path: "fs/exec.c", symbol: "setup_arg_pages" },
  groupExit: { project: "linux", path: "kernel/exit.c", symbol: "do_group_exit" },
  doExit: { project: "linux", path: "kernel/exit.c", symbol: "do_exit" },
  exitMm: { project: "linux", path: "kernel/exit.c", symbol: "exit_mm" },
  exitMmap: { project: "linux", path: "mm/mmap.c", symbol: "exit_mmap" },
  wait4: { project: "linux", path: "kernel/exit.c", symbol: "kernel_wait4" },
} satisfies Record<string, CodeRef>;

// ---------------------------------------------------------------- data

/** A C string as C source would write it, with escapes, shortened if long. */
export function quoted(text: string, max = 40): string {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
  return `"${escaped.length > max ? `${escaped.slice(0, max)}…` : escaped}"`;
}

export function syscall(title: string, fields: Header["fields"]): Header {
  return { kind: "syscall", title, fields };
}

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

// ---------------------------------------------------------------- tracing

/** What every program's state has: the steps below read and change only this. */
interface Shared {
  stage: string;
  at: number;
  out: string;
  inbuf: string;
  changed: string[];
}

export interface Tracer<S extends Program> {
  readonly state: S;
  readonly steps: Step[];
  /** Records a step, with the program as it is once the step's changes are made. */
  add(step: Step, patch?: Partial<S>, changed?: string[]): void;
}

export function tracer<S extends Program>(start: S): Tracer<S> {
  let state = start;
  const steps: Step[] = [];
  return {
    get state() {
      return state;
    },
    steps,
    add(step, patch = {}, changed = []) {
      state = { ...state, ...patch, changed };
      steps.push({ ...step, ui: { ...step.ui, program: state } });
    },
  };
}

/** A patch of the fields every program has; the cast is safe because both state types have them. */
function shared<S extends Program>(patch: Partial<Shared>): Partial<S> {
  return patch as Partial<S>;
}

// ---------------------------------------------------------------- starting

export interface StartOptions {
  /** The command as typed, e.g. "./marks". */
  command: string;
  /** The program's name in sentences, e.g. "marks". */
  name: string;
  /** Example addresses for the memory map frame. */
  exe: number;
  heap: number;
  ld: number;
  stack: number;
  /** More to say about what the C library brings, if anything. */
  libc?: string;
}

const hex = (n: number) => `0x${n.toString(16)}`;

/** From the Enter key to main()'s first line: the shell starts the program. */
export function startSteps<S extends Program>(t: Tracer<S>, o: StartOptions): void {
  t.add(keysStep("key", "terminal", "You press Enter", "Terminal"));
  t.add({
    id: "pty",
    phase: "input",
    path: ["terminal", "syscall", "tty", "bash"],
    title: "Through the pseudo-terminal",
    body: "The terminal writes the line into its end of the pseudo-terminal. The kernel's TTY layer delivers it to bash, which reads it from /dev/pts/N as if from a real keyboard.",
    code: [CODE.ptyWrite, { project: "linux", path: "drivers/tty/tty_io.c" }],
    timescale: "us",
  });
  t.add({
    id: "fork-exec",
    phase: "launch",
    path: ["bash", "syscall", "proc", PROGRAM],
    title: `bash starts ${o.command}`,
    body: `The command has a slash in it, so bash runs that file rather than searching PATH: it creates a child with clone(), and the child calls execve("${o.command}"). ${o.name} inherits bash's open files, so its standard input, output and error (0, 1 and 2) are the same pseudo-terminal.`,
    code: [CODE.clone, CODE.execve],
    timescale: "us",
  });
  t.add({
    id: "exec-map",
    phase: "memory",
    mode: "deep",
    path: ["proc", "mm"],
    frames: [
      dataFrame(
        1,
        "Memory map",
        "The new process's address space, before main()",
        vma(`${hex(o.exe)} ${o.name}`, "r-x code, rw- data", "the program file, through the page cache"),
        vma("[heap]", "none yet", `the program break starts at ${hex(o.heap)}`),
        vma(`${hex(o.ld)} ld-linux-x86-64.so.2`, "r-x code, rw- data", "the dynamic linker's file"),
        vma(`${hex(o.stack)} [stack]`, "rw-", "anonymous memory: argv and the environment at the top"),
      ),
    ],
    title: "A fresh address space",
    body: "execve() throws away the copy of bash's memory and builds a new map: the program's code and data from the ELF file, the dynamic linker ld.so, and a stack at the top holding the arguments and the environment. There is no heap yet: the program break, the end of the heap, starts at a random distance past the program's data. ASLR picks all of these addresses at random, so they change on every run.",
    code: [CODE.execve, CODE.elf, CODE.argPages],
    timescale: "us",
  });
  t.add({
    id: "ldso",
    phase: "linking",
    mode: "deep",
    path: [PROGRAM, "glibc"],
    title: "ld.so loads the C library",
    body: `Before main() runs, ld.so maps libc.so.6 and links ${o.name} to it: printf(), fgets(), malloc() and the rest are the C library's code, running inside ${o.name}.${o.libc ?? ""} The C library sets itself up; stdin, stdout and stderr exist, but none has a buffer yet.`,
    code: [
      { project: "glibc", path: "elf/rtld.c", symbol: "dl_main" },
      { project: "glibc", path: "csu/libc-start.c", symbol: "__libc_start_main" },
    ],
    timescale: "us",
  });
}

// ---------------------------------------------------------------- input and output

/**
 * The steps every typed line takes: the keys, the echo, the wake-up and
 * read(). `waking` is what else changes when the program gets a core back.
 */
export function typedSteps<S extends Program>(t: Tracer<S>, typed: string, line: number, stdin: string, waking: Partial<S> = {}): void {
  const shown = typed.length > 24 ? `${typed.slice(0, 24)}…` : typed;
  const bytes = byteLength(typed) + 1;
  t.add(keysStep("key", "terminal", typed === "" ? "You press Enter" : `You type ${shown} and press Enter`, "Terminal"), shared({ at: line }));
  t.add(
    {
      id: "echo",
      phase: "input",
      mode: "deep",
      path: ["terminal", "syscall", "tty", "terminal"],
      title: "The TTY echoes each key",
      body: "The terminal writes each key into its end of the pseudo-terminal. The line discipline is in canonical mode: it keeps the characters in a line buffer (Backspace edits it there) and echoes each one back, so the terminal draws what you type. The program, asleep in read(), sees nothing yet.",
      code: [CODE.ptyWrite, CODE.receive, CODE.echo],
      timescale: "us",
    },
    shared({ at: line }),
  );
  t.add(
    {
      id: "wake",
      phase: "input",
      path: ["tty", "sched", PROGRAM],
      title: "Enter completes the line",
      body: "The newline ends the line, so the line discipline wakes whoever waits to read it. The scheduler marks the program runnable and soon puts it back on a core, inside read(), where it went to sleep.",
      code: [CODE.receive, CODE.wake],
      timescale: "us",
    },
    { ...waking, ...shared<S>({ stage: "running", at: line }) },
  );
  t.add(
    {
      id: "read",
      phase: "input",
      path: ["tty", "syscall", "glibc"],
      parts: MEMORY,
      frames: [
        dataFrame(0, "System call", "read() returns", syscall("read(0, …)", [
          { name: "File descriptor", value: "0: standard input, the pseudo-terminal" },
          { name: "Into", value: `${stdin}: stdin's buffer, on the heap` },
          { name: "Asked for", value: "up to 1024 bytes" },
          { name: "Returns", value: `${bytes}: ${quoted(`${typed}\n`)}` },
        ])),
      ],
      title: `read() returns ${bytes} byte${bytes === 1 ? "" : "s"}`,
      body: `n_tty_read() copies the line, ${quoted(`${typed}\n`)}, from the TTY's buffer into stdin's buffer on the heap: a copy from kernel memory to the program's, made by the same core in kernel mode. read() returns ${bytes}, and the C library has its line.`,
      code: [CODE.ttyRead, CODE.canonCopy, CODE.read],
      timescale: "us",
    },
    shared({ inbuf: `${typed}\n`, at: line }),
    ["stdin"],
  );
}

/** printf() of a prompt: the bytes wait in stdout's buffer, since they end without a newline. */
export function promptStep<S extends Program>(t: Tracer<S>, id: string, text: string, line: number, body: string): void {
  t.add(
    {
      id,
      phase: "output",
      path: [PROGRAM, "glibc"],
      parts: MEMORY,
      title: `printf(${quoted(text, 28)})`,
      body,
      code: [CODE.printf],
      timescale: "ns",
    },
    shared({ out: t.state.out + text, at: line }),
    ["stdout"],
  );
}

/** A line printed with a newline at its end: stdout is line-buffered, so it is written at once. */
export function printLines<S extends Program>(t: Tracer<S>, id: string, lines: string[], line: number, title: string, body: string): void {
  const first = lines[0] ?? "";
  t.add(
    {
      id,
      phase: "output",
      path: [PROGRAM, "glibc", "syscall", "tty", "terminal"],
      frames: [
        dataFrame(2, "System call", lines.length > 1 ? "One line, one write()" : "The line is written", syscall("write(1, …)", [
          { name: "File descriptor", value: "1: standard output, the pseudo-terminal" },
          { name: "Bytes", value: quoted(`${first}\n`, 44) },
          { name: "Count", value: String(byteLength(`${first}\n`)) },
        ])),
      ],
      title,
      body,
      code: [CODE.printf, CODE.write, CODE.ttyWrite],
      timescale: "us",
      ui: { terminalAppend: lines.map((text): TermLine => ({ kind: "output", text })) },
    },
    shared({ out: "", at: line }),
    ["stdout"],
  );
}

/**
 * fgets() finds stdin's buffer empty: stdout is flushed, then read() puts the
 * program to sleep. `sleeping` is what else changes when it gives up its core.
 */
export function waitSteps<S extends Program>(
  t: Tracer<S>,
  line: number,
  stage: S["stage"],
  where: string,
  stdin: string,
  sleeping: Partial<S> = {},
): void {
  const text = t.state.out;
  t.add(
    {
      id: "flush",
      phase: "output",
      path: ["glibc", "syscall", "tty", "terminal"],
      frames: [
        dataFrame(1, "System call", "write() sends the prompt", syscall("write(1, …)", [
          { name: "File descriptor", value: "1: standard output, the pseudo-terminal" },
          { name: "Bytes", value: quoted(text) },
          { name: "Count", value: String(byteLength(text)) },
        ])),
      ],
      title: "The prompt is written",
      body: `${where} stdin's buffer is empty, so the C library must read(). First it flushes stdout, because stdout is line-buffered on a terminal: write(1, ${quoted(text, 24)}, ${byteLength(text)}). The bytes go through the TTY layer to the terminal, which draws them.`,
      code: [CODE.underflow, CODE.write, CODE.ttyWrite],
      timescale: "us",
      ui: { terminalAppend: [{ kind: "ask", text }] },
    },
    shared({ out: "", at: line }),
    ["stdout"],
  );
  t.add(
    {
      id: "sleep",
      phase: "input",
      path: ["glibc", "syscall", "tty", "sched"],
      frames: [
        dataFrame(1, "System call", "read() has to wait", syscall("read(0, …)", [
          { name: "File descriptor", value: "0: standard input, the pseudo-terminal" },
          { name: "Into", value: `${stdin}: stdin's buffer` },
          { name: "Asked for", value: "up to 1024 bytes" },
          { name: "Returns", value: "not yet: no complete line" },
        ])),
      ],
      title: "read() sleeps until you press Enter",
      body: "read(0, …) finds no complete line in the TTY (in canonical mode it only hands out whole lines), so n_tty_read() puts the program to sleep and the scheduler gives the core to other work. A program waiting for input uses no CPU at all. Your turn: type in the Terminal.",
      code: [CODE.ttyRead, CODE.schedule],
      timescale: "us",
      ui: { terminalBusy: false },
    },
    { ...sleeping, ...shared<S>({ stage, at: line }) },
  );
}

/** The end of a program: exit_group(), the address space torn down, bash's prompt. */
export function exitSteps<S extends Program>(t: Tracer<S>, name: string, line: number, patch: Partial<S>, extra: string): void {
  t.add(
    {
      id: "exit",
      phase: "launch",
      path: [PROGRAM, "syscall", "proc"],
      title: "return 0, then exit_group()",
      body: `main() checks its canary (unchanged, so no stack overflow to report) and returns 0 to the C library, which calls exit(0): it flushes stdout, empty by now, and makes the exit_group(0) system call. The kernel's do_exit() starts taking the process apart.${extra}`,
      code: [CODE.startMain, CODE.exit, CODE.groupExit, CODE.doExit],
      timescale: "us",
    },
    { ...patch, ...shared<S>({ at: line }) },
    ["frame:main"],
  );
  t.add(
    {
      id: "exit-mm",
      phase: "memory",
      path: ["proc", "mm", "ram"],
      title: "The whole address space goes",
      body: `exit_mm() lets go of the process's memory. ${name} was its only user, so exit_mmap() unmaps every area and frees every page: the heap's, the stacks', the data's. The kernel never knew about chunks or the C library's lists. It hands out pages and takes them back; the C library does the rest.`,
      code: [CODE.exitMm, CODE.exitMmap],
      timescale: "us",
    },
    shared({ stage: "exited", at: line }),
  );
  t.add({
    id: "bash",
    phase: "output",
    path: ["proc", "bash"],
    title: "bash takes over",
    body: `bash has been waiting in wait4() since it started ${name}. It collects the exit status, 0, and prints a new prompt.`,
    code: [CODE.wait4],
    timescale: "us",
    ui: { terminalBusy: false },
  });
}
