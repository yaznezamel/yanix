"use client";

import { useSyncExternalStore } from "react";
import { EthernetIcon, SearchIcon, SpeakerIcon, StartIcon } from "./icons";

// A shared clock that ticks while any component listens. On the server, and
// during hydration, it reads 0 so the markup matches; the client fills it in.
let now = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 10_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => 0,
  );
}

export interface TaskbarApp {
  id: string;
  label: string;
  icon: React.ReactNode;
  running: boolean;
  focused: boolean;
  tracing: boolean;
  onClick: () => void;
}

interface TaskbarProps {
  apps: TaskbarApp[];
  startOpen: boolean;
  onStart: () => void;
}

function Slot({
  label,
  onClick,
  active,
  children,
  running,
  focused,
  tracing,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  running?: boolean;
  focused?: boolean;
  tracing?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`relative grid h-10 w-10 place-items-center rounded-md transition ${
        active || focused ? "bg-white/10" : "hover:bg-white/[0.07]"
      } ${tracing ? "ring-1 ring-signal/70 shadow-[0_0_14px_rgba(63,224,255,0.45)]" : ""}`}
    >
      <span className="size-6">{children}</span>
      {running && (
        <span
          className={`absolute bottom-0.5 h-[3px] rounded-full transition-all ${
            focused ? "w-4 bg-signal" : "w-1.5 bg-white/60"
          }`}
        />
      )}
    </button>
  );
}

export function Taskbar({ apps, startOpen, onStart }: TaskbarProps) {
  const time = useNow();
  const date = time ? new Date(time) : null;

  return (
    <nav
      aria-label="Taskbar"
      className="absolute inset-x-0 bottom-0 z-[60] flex h-12 items-center border-t border-white/10 bg-[#1c2028]/80 px-3 backdrop-blur-xl"
    >
      <div className="flex-1" />
      <div className="flex items-center gap-1">
        <Slot label="Start" onClick={onStart} active={startOpen}>
          <StartIcon className="size-6" />
        </Slot>
        <Slot label="Search" onClick={onStart}>
          <SearchIcon className="size-5 text-white/85" />
        </Slot>
        {apps.map((app) => (
          <Slot
            key={app.id}
            label={app.label}
            onClick={app.onClick}
            running={app.running}
            focused={app.focused}
            tracing={app.tracing}
          >
            {app.icon}
          </Slot>
        ))}
      </div>
      <div className="flex flex-1 items-center justify-end gap-3 text-white/85">
        <span className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-white/[0.07]">
          <EthernetIcon className="size-4" />
          <SpeakerIcon className="size-4" />
        </span>
        <span className="flex flex-col items-end text-[11px] leading-tight tabular-nums">
          <span>{date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : " "}</span>
          <span>{date ? date.toLocaleDateString() : " "}</span>
        </span>
      </div>
    </nav>
  );
}
