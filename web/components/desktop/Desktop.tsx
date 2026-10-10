"use client";

import { AnimatePresence } from "motion/react";
import { useRef, useState } from "react";
import type { AppId, AppState } from "@/lib/xray/types";
import styles from "../lab/lab.module.css";
import { BrowserApp, BrowserTabs } from "./BrowserApp";
import { StartMenu } from "./StartMenu";
import { Taskbar } from "./Taskbar";
import { TerminalApp } from "./TerminalApp";
import { WelcomeApp } from "./WelcomeApp";
import { Window, type WindowFrameState } from "./Window";
import { BrowserIcon, TerminalIcon, WelcomeIcon } from "./icons";

type WinId = AppId | "welcome";

const CLOSED: WindowFrameState = { open: false, minimized: false, maximized: false, z: 1 };

const RECTS: Record<WinId, { x: number; y: number; w: number; h: number }> = {
  browser: { x: 70, y: 22, w: 800, h: 500 },
  terminal: { x: 190, y: 120, w: 600, h: 380 },
  welcome: { x: 250, y: 120, w: 460, h: 330 },
};

const META: Record<WinId, { title: string; icon: React.ReactNode }> = {
  browser: { title: "Chromium", icon: <BrowserIcon className="size-full" /> },
  terminal: { title: "you@yanix: ~", icon: <TerminalIcon className="size-full" /> },
  welcome: { title: "Get started", icon: <WelcomeIcon className="size-full" /> },
};

interface DesktopProps {
  apps: AppState;
  tracing: AppId | null;
  onLaunch: (app: AppId) => void;
  onClose: (app: AppId) => void;
  onSearch: (query: string) => void;
  onCommand: (command: string) => void;
}

export function Desktop({ apps, tracing, onLaunch, onClose, onSearch, onCommand }: DesktopProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [windows, setWindows] = useState<Record<WinId, WindowFrameState>>({
    browser: CLOSED,
    terminal: CLOSED,
    welcome: { open: true, minimized: false, maximized: false, z: 2 },
  });
  const [topZ, setTopZ] = useState(2);
  const [startOpen, setStartOpen] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState<WinId | null>(null);

  const focusedId = (Object.keys(windows) as WinId[])
    .filter((id) => windows[id].open && !windows[id].minimized)
    .sort((a, b) => windows[b].z - windows[a].z)[0];

  function patch(id: WinId, change: Partial<WindowFrameState>) {
    setWindows((w) => ({ ...w, [id]: { ...w[id], ...change } }));
  }

  function focus(id: WinId) {
    if (focusedId === id) return;
    const z = topZ + 1;
    setTopZ(z);
    patch(id, { z, minimized: false });
  }

  function open(id: WinId) {
    const z = topZ + 1;
    setTopZ(z);
    const wasOpen = windows[id].open;
    patch(id, { open: true, minimized: false, z });
    if (!wasOpen && id !== "welcome") onLaunch(id);
  }

  function close(id: WinId) {
    patch(id, { ...CLOSED });
    if (id !== "welcome") onClose(id);
  }

  function taskbarClick(id: WinId) {
    const w = windows[id];
    if (!w.open) open(id);
    else if (w.minimized) focus(id);
    else if (focusedId === id) patch(id, { minimized: true });
    else focus(id);
  }

  const desktopIcons: WinId[] = ["browser", "terminal", "welcome"];

  return (
    <div className="relative h-full w-full overflow-hidden text-[13px] text-white">
      <div className={`absolute inset-0 ${styles.wallpaper}`}>
        <div className={styles.ribbon} />
      </div>

      <div className="absolute left-3 top-3 z-[1] flex flex-col gap-1">
        {desktopIcons.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSelectedIcon(id)}
            onDoubleClick={() => open(id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") open(id);
            }}
            className={`flex w-[76px] flex-col items-center gap-1 rounded-md border px-1 py-2 text-[11px] text-white/90 ${
              selectedIcon === id ? "border-white/25 bg-white/15" : "border-transparent hover:bg-white/10"
            }`}
          >
            <span className="size-9">{META[id].icon}</span>
            <span className="text-center leading-tight [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
              {id === "welcome" ? "Get started" : id === "browser" ? "Chromium" : "Terminal"}
            </span>
          </button>
        ))}
      </div>

      <div ref={areaRef} className="absolute inset-x-0 top-0 bottom-12">
        <AnimatePresence>
          {(Object.keys(windows) as WinId[])
            .filter((id) => windows[id].open)
            .map((id) => (
              <Window
                key={id}
                title={META[id].title}
                icon={META[id].icon}
                state={windows[id]}
                focused={focusedId === id}
                tracing={tracing === id}
                bounds={areaRef}
                rect={RECTS[id]}
                dark={id === "terminal"}
                titleBar={id === "browser" ? <BrowserTabs state={apps.browser} /> : undefined}
                onFocus={() => focus(id)}
                onMinimize={() => patch(id, { minimized: true })}
                onToggleMaximize={() => patch(id, { maximized: !windows[id].maximized })}
                onClose={() => close(id)}
              >
                {id === "browser" && <BrowserApp state={apps.browser} onSearch={onSearch} />}
                {id === "terminal" && <TerminalApp state={apps.terminal} onCommand={onCommand} />}
                {id === "welcome" && <WelcomeApp onOpen={(app) => open(app)} />}
              </Window>
            ))}
        </AnimatePresence>
      </div>

      <StartMenu
        open={startOpen}
        onClose={() => setStartOpen(false)}
        items={desktopIcons.map((id) => ({
          id,
          label: id === "welcome" ? "Get started" : id === "browser" ? "Chromium" : "Terminal",
          icon: META[id].icon,
          onOpen: () => open(id),
        }))}
      />

      <Taskbar
        startOpen={startOpen}
        onStart={() => setStartOpen((o) => !o)}
        apps={(["browser", "terminal"] as const).map((id) => ({
          id,
          label: id === "browser" ? "Chromium" : "Terminal",
          icon: META[id].icon,
          running: windows[id].open,
          focused: focusedId === id,
          tracing: tracing === id,
          onClick: () => taskbarClick(id),
        }))}
      />
    </div>
  );
}
