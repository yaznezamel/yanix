import type { AppId, AppState, MachineState, Media, WindowId, WindowStatus } from "./types";

// The simulated computer's contents: its user, files, programs and the state
// every app starts in.

export const USER = "you";
export const HOME = `/home/${USER}`;
export const PROMPT = `${USER}@yanix:~$`;

export const SUGGESTED_QUERIES = [
  "how does dns work",
  "what is a system call",
  "linux page cache",
];

export const NOTES_FILE = `${HOME}/notes.txt`;

export const NOTES_TXT = [
  "Notes to self:",
  "- Programs never touch hardware directly. They ask the kernel.",
  "- The first read of this file came from the SSD.",
  "- Read it again: the page cache answers from RAM.",
];

export const MEDIA: Record<Media, { title: string; file: string; kind: string }> = {
  audio: { title: "Ocean waves", file: `${HOME}/Music/ocean-waves.opus`, kind: "Opus audio" },
  video: { title: "Sunrise timelapse", file: `${HOME}/Videos/sunrise.webm`, kind: "VP9 video, Opus audio" },
};

/**
 * What each app is called on screen, and the program file it runs. The
 * terminal is GNOME Console (kgx), a single process; Chromium's real binary
 * sits behind a launcher script in /usr/bin on most distributions.
 */
export const APPS: Record<AppId, { name: string; program: string; libraries: string[] }> = {
  browser: {
    name: "Chromium",
    program: "/usr/lib/chromium/chromium",
    libraries: ["libglib-2.0.so.0", "libnss3.so", "libc.so.6"],
  },
  terminal: {
    name: "Terminal",
    program: "/usr/bin/kgx",
    libraries: ["libvte-2.91-gtk4.so.0", "libadwaita-1.so.0", "libc.so.6"],
  },
  editor: {
    name: "Text Editor",
    program: "/usr/bin/gnome-text-editor",
    libraries: ["libgtk-4.so.1", "libadwaita-1.so.0", "libc.so.6"],
  },
  player: {
    name: "Videos",
    program: "/usr/bin/totem",
    libraries: ["libgstreamer-1.0.so.0", "libglib-2.0.so.0", "libc.so.6"],
  },
};

export const APP_IDS = Object.keys(APPS) as AppId[];

export const COLD_MACHINE: MachineState = {
  arpCached: false,
  dnsCached: false,
  connectionOpen: false,
  pageCache: [],
};

export function isCached(machine: MachineState, file: string): boolean {
  return machine.pageCache.includes(file);
}

export function withCached(machine: MachineState, file: string): Partial<MachineState> {
  return isCached(machine, file) ? {} : { pageCache: [...machine.pageCache, file] };
}

export const CLOSED_WINDOWS: Record<WindowId, WindowStatus> = {
  browser: "closed",
  terminal: "closed",
  editor: "closed",
  player: "closed",
  welcome: "closed",
};

const TERMINAL_BANNER = [
  { kind: "banner" as const, text: "Yanix terminal · commands are simulated, the kernel path is real" },
  { kind: "hint" as const, text: "Try: cat notes.txt   ·   help" },
];

/** Each app as it looks when it starts, without the window bookkeeping. */
export const FRESH_APPS: Omit<AppState, "screen" | "bootLog" | "windows" | "clipboard"> = {
  browser: {
    page: "newtab",
    draft: "",
    query: "",
    url: "",
    title: "New Tab",
    loading: false,
    status: null,
    progress: 0,
    secure: false,
  },
  terminal: { lines: TERMINAL_BANNER, busy: false },
  editor: { file: null, text: "", loading: false },
  player: { media: "audio", playing: false, status: null },
};

export const INITIAL_APPS: AppState = {
  screen: "desktop",
  bootLog: [],
  windows: { ...CLOSED_WINDOWS, welcome: "open" },
  ...FRESH_APPS,
  clipboard: null,
};
