import { MAX_THREADS_INPUT } from "./cores/program";
import { CORES_C } from "./cores/source";
import { MAX_INPUT_BYTES, fitInput } from "./marks/program";
import { MARKS_C } from "./marks/source";
import { programReads } from "./scenarios";
import type { AppState, Program, ScenarioRequest, TermLine } from "./types";

// What a line typed into the lab's terminal does. Whoever reads it decides:
// the C program, when it is waiting in fgets(), or else bash, for which only
// a few commands are traced and a few more answered in place.

/**
 * Ctrl+D, as it waits among typed-ahead lines: the byte the terminal sends,
 * 0x04, which a terminal in canonical mode reads as the end of input.
 */
export const EOT = "\u0004";

/** The longest line the program reads whole with one fgets(), in bytes. */
export function inputLimit(program: Program | null): number {
  return program?.kind === "cores" ? MAX_THREADS_INPUT : MAX_INPUT_BYTES;
}

/** Answers to try for each question a program asks: a good one, and one it should reject or end on. */
export function programAnswers(program: Program | null): string[] {
  if (!program) return [];
  if (program.kind === "cores") return program.stage === "threads" ? ["4", "1", "0"] : [];
  const answers: Partial<Record<typeof program.stage, string[]>> = {
    name: ["Ada", "Linus"],
    marks: ["72 85 90", "90 abc"],
    again: ["y", "n"],
  };
  return answers[program.stage] ?? [];
}

/** How a line that waits in the TTY looks: Ctrl+D shows as ^D. */
export const shownLine = (line: string) => (line === EOT ? "^D" : line);

/** The control keys the lab's terminal knows: what each sends, for a label. */
export const CONTROL_KEYS = [
  { key: "d", label: "Ctrl+D", what: "end of input" },
  { key: "c", label: "Ctrl+C", what: "interrupt" },
] as const;

/** A key event that is Ctrl+C or Ctrl+D (and nothing else held), as the key it is. */
export function controlKey(e: { ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean; key: string }): "c" | "d" | null {
  if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
  const key = e.key.toLowerCase();
  return key === "c" || key === "d" ? key : null;
}

/** A line's effect: a trace to start, or lines bash prints at once (or a cleared screen). */
export type Command = { kind: "trace"; request: ScenarioRequest } | { kind: "print"; lines: TermLine[] } | { kind: "clear" };

export function command(raw: string, apps: AppState): Command {
  // While the program reads, the line goes to it as typed: spaces and all.
  const program = apps.program;
  if (raw === EOT) {
    if (programReads(program)) return { kind: "trace", request: { kind: "programEof" } };
    return {
      kind: "print",
      lines: [
        { kind: "hint", text: "Ctrl+D at bash's prompt ends bash's input: bash would exit, and the terminal with it. The lab keeps it open." },
      ],
    };
  }
  if (programReads(program)) {
    return { kind: "trace", request: { kind: "programInput", text: fitInput(raw, inputLimit(program)) } };
  }
  const line = raw.trim().replace(/\s+/g, " ");
  if (line === "./marks" || line === "./cores") {
    return { kind: "trace", request: { kind: "runProgram", program: line === "./cores" ? "cores" : "marks" } };
  }
  if (line === "cat notes.txt") return { kind: "trace", request: { kind: "readFile" } };
  if (line === "clear") return { kind: "clear" };
  return { kind: "print", lines: reply(line) };
}

/** bash's answer to a command the lab does not trace. */
function reply(line: string): TermLine[] {
  const [name = "", ...args] = line.split(" ");
  const echo: TermLine = { kind: "prompt", text: line };
  switch (name) {
    case "":
      return [echo];
    case "help":
      return [
        echo,
        { kind: "output", text: "Traced commands:" },
        { kind: "output", text: "  cat notes.txt   read a file: VFS, the page cache, the SSD" },
        { kind: "output", text: "  ./marks         a C program's stack and heap (Memory tab)" },
        { kind: "output", text: "  ./cores         threads on every core (Memory, Hardware)" },
        { kind: "output", text: "Also: ls · cat marks.c · cat cores.c · make · clear · help" },
        { kind: "hint", text: "Other apps trace too: search in Chromium, open notes.txt in the Text Editor, play a sound in Videos." },
      ];
    case "ls":
      return [echo, { kind: "output", text: "Makefile  cores  cores.c  marks  marks.c  notes.txt" }];
    case "cat": {
      const file = args.join(" ");
      const source = file === "marks.c" ? MARKS_C : file === "cores.c" ? CORES_C : null;
      if (source) {
        return [
          echo,
          ...source.map((text): TermLine => ({ kind: "output", text: text.replace(/\t/g, "        ") })),
          { kind: "hint", text: `Not traced: cat notes.txt is. Run the program with ./${file.slice(0, -2)}.` },
        ];
      }
      return [echo, { kind: "output", text: `cat: ${file || "-"}: No such file or directory` }];
    }
    case "make":
      return [echo, { kind: "output", text: "make: Nothing to be done for 'all'." }];
    case "marks":
    case "cores":
      return [
        echo,
        { kind: "output", text: `bash: ${name}: command not found` },
        { kind: "hint", text: `bash looks for commands in PATH, not in the current directory: type ./${name}` },
      ];
    default:
      return [
        echo,
        { kind: "output", text: `bash: ${name}: command not found` },
        { kind: "hint", text: "Only cat notes.txt, ./marks and ./cores are traced. Type help." },
      ];
  }
}
