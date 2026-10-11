"use client";

import { SUGGESTED_QUERIES } from "@/lib/xray/apps";
import type { AppId, AppState, ScenarioRequest } from "@/lib/xray/types";

// On a phone the simulated screen is too small to tap, so the same actions are
// offered as full-size buttons under it. Each one starts the trace the desktop
// would: open an app first, then do the thing it is for.

interface QuickActionsProps {
  apps: AppState;
  /** A trace is playing: wait for it (or skip to its end) before starting another. */
  busy: boolean;
  onRequest: (request: ScenarioRequest) => void;
  onCommand: (command: string) => void;
}

interface Action {
  label: string;
  detail: string;
  run: () => void;
  disabled?: boolean;
}

const APP_NAME: Record<AppId, string> = {
  browser: "Chromium",
  terminal: "the Terminal",
  editor: "the Text Editor",
  player: "Videos",
};

export function QuickActions({ apps, busy, onRequest, onCommand }: QuickActionsProps) {
  const actions: Action[] = [];
  const launch = (app: AppId, then: Action): Action =>
    apps.windows[app] === "open"
      ? then
      : {
          label: `Open ${APP_NAME[app]}`,
          detail: "Launch it: a new process, the program loaded, its window drawn",
          run: () => onRequest({ kind: "launch", app }),
          disabled: apps.windows[app] === "starting",
        };

  if (apps.screen === "off") {
    actions.push({ label: "Press the power button", detail: "Firmware, bootloader, kernel, systemd", run: () => onRequest({ kind: "boot" }) });
  } else if (apps.screen === "login") {
    actions.push({ label: "Log in", detail: "PAM checks the password, logind starts your session", run: () => onRequest({ kind: "login" }) });
  } else if (apps.screen === "desktop") {
    const query = SUGGESTED_QUERIES[0] ?? "how does dns work";
    actions.push(
      launch("browser", {
        label: `Search “${query}”`,
        detail: "DNS, TCP, TLS and HTTP, packet by packet",
        run: () => onRequest({ kind: "search", query }),
      }),
      launch("editor", {
        label: "Open notes.txt",
        detail: "open() and read(): the page cache, then the SSD if it misses",
        run: () => onRequest({ kind: "openFile" }),
      }),
      launch("player", {
        label: "Play a sound",
        detail: "PipeWire, the ring buffer, the sound card",
        run: () => onRequest({ kind: "play", media: "audio" }),
      }),
      launch("terminal", {
        label: "Run cat notes.txt",
        detail: "A process, a pseudo-terminal and a read",
        run: () => onCommand("cat notes.txt"),
      }),
      {
        label: "Restart the computer",
        detail: "Shutdown, then boot from the firmware up",
        run: () => onRequest({ kind: "restart" }),
      },
    );
  }

  if (actions.length === 0) return null;
  return (
    <section aria-label="Try it" className="rounded-xl border border-lab-line bg-lab-panel p-3 md:hidden">
      <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-lab-muted">Try it</h2>
      {busy && (
        <p className="mb-2 text-[12px] text-lab-muted">A trace is playing. Let it finish, or skip to its end, to try another.</p>
      )}
      <div className="grid gap-2">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.run}
            disabled={busy || a.disabled}
            className="flex min-h-11 flex-col items-start rounded-lg border border-lab-line bg-lab-panel2 px-3 py-2 text-left hover:border-white/25 disabled:opacity-50"
          >
            <span className="text-[14px] font-semibold text-lab-ink">{a.label}</span>
            <span className="text-[12px] text-lab-muted">{a.detail}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
