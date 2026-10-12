"use client";

import { AnimatePresence } from "motion/react";
import { useRef, useState } from "react";
import { APPS } from "@/lib/xray/apps";
import type { AppId, AppState, Media, WindowId } from "@/lib/xray/types";
import styles from "../lab/lab.module.css";
import { BrowserApp, BrowserTabs } from "./BrowserApp";
import { EditorApp } from "./EditorApp";
import { PlayerApp } from "./PlayerApp";
import {
  BootloaderScreen,
  FirmwareScreen,
  KernelScreen,
  LoginScreen,
  OffScreen,
  ShutdownScreen,
} from "./PowerScreens";
import { StartMenu } from "./StartMenu";
import { Taskbar } from "./Taskbar";
import { TerminalApp } from "./TerminalApp";
import { WelcomeApp } from "./WelcomeApp";
import { Window } from "./Window";
import { BrowserIcon, EditorIcon, PlayerIcon, TerminalIcon, WelcomeIcon } from "./icons";

type PowerAction = "boot" | "login" | "shutdown" | "restart";
type TextApp = "browser" | "editor";

interface Frame {
  minimized: boolean;
  maximized: boolean;
  z: number;
}

const ORDER: WindowId[] = ["browser", "terminal", "editor", "player", "welcome"];
const APP_ORDER: AppId[] = ["browser", "terminal", "editor", "player"];

const RECTS: Record<WindowId, { x: number; y: number; w: number; h: number }> = {
  browser: { x: 70, y: 22, w: 800, h: 500 },
  terminal: { x: 190, y: 120, w: 600, h: 380 },
  editor: { x: 140, y: 60, w: 580, h: 400 },
  player: { x: 230, y: 50, w: 620, h: 400 },
  welcome: { x: 220, y: 70, w: 520, h: 440 },
};

const META: Record<WindowId, { title: string; label: string; icon: React.ReactNode }> = {
  browser: { title: "Chromium", label: "Chromium", icon: <BrowserIcon className="size-full" /> },
  terminal: { title: "you@yanix: ~", label: "Terminal", icon: <TerminalIcon className="size-full" /> },
  editor: { title: "Text Editor", label: "Text Editor", icon: <EditorIcon className="size-full" /> },
  player: { title: "Videos", label: APPS.player.name, icon: <PlayerIcon className="size-full" /> },
  welcome: { title: "Get started", label: "Get started", icon: <WelcomeIcon className="size-full" /> },
};

const INITIAL_FRAMES: Record<WindowId, Frame> = {
  browser: { minimized: false, maximized: false, z: 1 },
  terminal: { minimized: false, maximized: false, z: 1 },
  editor: { minimized: false, maximized: false, z: 1 },
  player: { minimized: false, maximized: false, z: 1 },
  welcome: { minimized: false, maximized: false, z: 2 },
};

interface DesktopProps {
  apps: AppState;
  tracing: AppId | null;
  /** Lines typed into the terminal while a trace plays, not read yet. */
  typedAhead: string[];
  /** Fields a running trace is about to change. */
  locked: { draft: boolean; editor: boolean; player: boolean };
  restarting: boolean;
  loggingIn: boolean;
  onLaunch: (app: AppId) => void;
  onClose: (app: AppId) => void;
  onWelcome: (open: boolean) => void;
  onSearch: (query: string) => void;
  onDraft: (text: string) => void;
  onCommand: (command: string) => void;
  onControl: (key: "c" | "d") => void;
  onOpenFile: () => void;
  onEditorText: (text: string) => void;
  onKeystroke: (app: TextApp, key: string) => void;
  onCopy: (app: TextApp, text: string) => void;
  onPaste: (app: TextApp) => void;
  onPlay: (media: Media) => void;
  onPause: () => void;
  onPower: (action: PowerAction) => void;
}

export function Desktop(props: DesktopProps) {
  const { apps, tracing, locked, onLaunch, onClose, onWelcome, onPower } = props;
  const areaRef = useRef<HTMLDivElement>(null);
  const [frames, setFrames] = useState(INITIAL_FRAMES);
  const [topZ, setTopZ] = useState(2);
  const [startOpen, setStartOpen] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState<WindowId | null>(null);

  // A window that opens from outside the desktop (a "Try it" button, the
  // Memory tab) comes to the front, as one opened from here does.
  const [windows, setWindows] = useState(apps.windows);
  if (windows !== apps.windows) {
    setWindows(apps.windows);
    const opened = ORDER.filter((id) => windows[id] === "closed" && apps.windows[id] !== "closed");
    if (opened.length > 0) {
      const z = topZ + opened.length;
      setTopZ(z);
      setFrames((f) => {
        const next = { ...f };
        opened.forEach((id, i) => (next[id] = { ...next[id], z: z - opened.length + 1 + i, minimized: false }));
        return next;
      });
    }
  }

  const isOpen = (id: WindowId) => apps.windows[id] === "open";
  const focusedId = ORDER.filter((id) => isOpen(id) && !frames[id].minimized).sort(
    (a, b) => frames[b].z - frames[a].z,
  )[0];

  function patch(id: WindowId, change: Partial<Frame>) {
    setFrames((f) => ({ ...f, [id]: { ...f[id], ...change } }));
  }

  function raise(id: WindowId) {
    const z = topZ + 1;
    setTopZ(z);
    patch(id, { z, minimized: false });
  }

  /** Windows open when the app draws its first frame; until then the app is "starting". */
  function open(id: WindowId) {
    const status = apps.windows[id];
    if (status === "starting") return;
    raise(id);
    if (status === "open") return;
    if (id === "welcome") onWelcome(true);
    else onLaunch(id);
  }

  function close(id: WindowId) {
    patch(id, { minimized: false, maximized: false });
    if (id === "welcome") onWelcome(false);
    else onClose(id);
  }

  function taskbarClick(id: WindowId) {
    if (!isOpen(id)) open(id);
    else if (frames[id].minimized) raise(id);
    else if (focusedId === id) patch(id, { minimized: true });
    else raise(id);
  }

  switch (apps.screen) {
    case "off":
      return <OffScreen onPowerOn={() => onPower("boot")} restarting={props.restarting} />;
    case "firmware":
      return <FirmwareScreen />;
    case "bootloader":
      return <BootloaderScreen />;
    case "kernel":
      return <KernelScreen lines={apps.bootLog} />;
    case "login":
      return <LoginScreen busy={props.loggingIn} onLogin={() => onPower("login")} />;
    case "shutdown":
      return <ShutdownScreen restarting={props.restarting} />;
    case "desktop":
      break;
  }

  const canPaste = apps.clipboard !== null;

  return (
    <div className="relative h-full w-full overflow-hidden text-[13px] text-white">
      <div className={`absolute inset-0 ${styles.wallpaper}`}>
        <div className={styles.ribbon} />
      </div>

      <div className="absolute left-3 top-3 z-[1] flex flex-col gap-1">
        {ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSelectedIcon(id)}
            onDoubleClick={() => open(id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") open(id);
            }}
            className={`flex w-[76px] flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[11px] text-white/90 ${
              selectedIcon === id ? "border-white/25 bg-white/15" : "border-transparent hover:bg-white/10"
            }`}
          >
            <span className="size-8">{META[id].icon}</span>
            <span className="text-center leading-tight [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
              {META[id].label}
            </span>
          </button>
        ))}
      </div>

      <div ref={areaRef} className="absolute inset-x-0 top-0 bottom-12">
        <AnimatePresence>
          {ORDER.filter(isOpen).map((id) => (
            <Window
              key={id}
              title={META[id].title}
              icon={META[id].icon}
              state={{ open: true, ...frames[id] }}
              focused={focusedId === id}
              tracing={tracing === id}
              bounds={areaRef}
              rect={RECTS[id]}
              dark={id === "terminal"}
              titleBar={id === "browser" ? <BrowserTabs state={apps.browser} /> : undefined}
              onFocus={() => {
                if (focusedId !== id) raise(id);
              }}
              onMinimize={() => patch(id, { minimized: true })}
              onToggleMaximize={() => patch(id, { maximized: !frames[id].maximized })}
              onClose={() => close(id)}
            >
              {id === "browser" && (
                <BrowserApp
                  state={apps.browser}
                  locked={locked.draft}
                  canPaste={canPaste}
                  onSearch={props.onSearch}
                  onDraft={props.onDraft}
                  onKeystroke={(key) => props.onKeystroke("browser", key)}
                  onCopy={(text) => props.onCopy("browser", text)}
                  onPaste={() => props.onPaste("browser")}
                />
              )}
              {id === "terminal" && (
                <TerminalApp
                  state={apps.terminal}
                  program={apps.program}
                  typedAhead={props.typedAhead}
                  onCommand={props.onCommand}
                  onControl={props.onControl}
                />
              )}
              {id === "editor" && (
                <EditorApp
                  state={apps.editor}
                  locked={locked.editor}
                  canPaste={canPaste}
                  onOpen={props.onOpenFile}
                  onText={props.onEditorText}
                  onKeystroke={(key) => props.onKeystroke("editor", key)}
                  onCopy={(text) => props.onCopy("editor", text)}
                  onPaste={() => props.onPaste("editor")}
                />
              )}
              {id === "player" && (
                <PlayerApp state={apps.player} busy={locked.player} onPlay={props.onPlay} onPause={props.onPause} />
              )}
              {id === "welcome" && <WelcomeApp onOpen={(app) => open(app)} onRestart={() => onPower("restart")} />}
            </Window>
          ))}
        </AnimatePresence>
      </div>

      <StartMenu
        open={startOpen}
        onClose={() => setStartOpen(false)}
        onShutdown={() => onPower("shutdown")}
        onRestart={() => onPower("restart")}
        items={ORDER.map((id) => ({
          id,
          label: META[id].label,
          icon: META[id].icon,
          onOpen: () => open(id),
        }))}
      />

      <Taskbar
        startOpen={startOpen}
        onStart={() => setStartOpen((o) => !o)}
        apps={APP_ORDER.map((id) => ({
          id,
          label: META[id].label,
          icon: META[id].icon,
          running: isOpen(id),
          starting: apps.windows[id] === "starting",
          focused: focusedId === id,
          tracing: tracing === id,
          onClick: () => taskbarClick(id),
        }))}
      />
    </div>
  );
}
