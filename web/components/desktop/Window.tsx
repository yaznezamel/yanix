"use client";

import { motion, useDragControls, useMotionValue } from "motion/react";
import type { RefObject } from "react";

export interface WindowFrameState {
  open: boolean;
  minimized: boolean;
  maximized: boolean;
  z: number;
}

interface WindowProps {
  title: string;
  icon: React.ReactNode;
  state: WindowFrameState;
  focused: boolean;
  tracing: boolean;
  bounds: RefObject<HTMLDivElement | null>;
  rect: { x: number; y: number; w: number; h: number };
  /** Replaces the plain title, e.g. with browser tabs. */
  titleBar?: React.ReactNode;
  dark?: boolean;
  onFocus: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  children: React.ReactNode;
}

function Control({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={`grid h-full w-11 place-items-center text-white/80 transition ${
        danger ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

export function Window({
  title,
  icon,
  state,
  focused,
  tracing,
  bounds,
  rect,
  titleBar,
  dark,
  onFocus,
  onMinimize,
  onToggleMaximize,
  onClose,
  children,
}: WindowProps) {
  const drag = useDragControls();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const max = state.maximized;

  return (
    <motion.section
      aria-label={`${title} window`}
      drag={!max}
      dragControls={drag}
      dragListener={false}
      dragMomentum={false}
      dragConstraints={bounds}
      dragElastic={0}
      onPointerDownCapture={onFocus}
      className="absolute"
      style={{
        x: max ? 0 : x,
        y: max ? 0 : y,
        left: max ? 0 : rect.x,
        top: max ? 0 : rect.y,
        width: max ? "100%" : rect.w,
        height: max ? "100%" : rect.h,
        zIndex: state.z,
        pointerEvents: state.minimized ? "none" : "auto",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 14 }}
        animate={
          state.minimized
            ? { opacity: 0, scale: 0.7, y: 220 }
            : { opacity: 1, scale: 1, y: 0 }
        }
        exit={{ opacity: 0, scale: 0.92, y: 10 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className={`flex h-full flex-col overflow-hidden border shadow-[0_18px_50px_rgba(0,0,0,0.55)] ${
          max ? "rounded-none" : "rounded-lg"
        } ${focused ? "border-white/20" : "border-white/10"} ${dark ? "bg-[#101215]" : "bg-[#202124]"}`}
      >
        <div
          onPointerDown={(e) => {
            if (!max) drag.start(e);
          }}
          onDoubleClick={onToggleMaximize}
          className={`flex h-9 shrink-0 items-stretch ${focused ? "bg-[#2b2d31]" : "bg-[#25272b]"} ${
            max ? "" : "cursor-grab active:cursor-grabbing"
          }`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-3">
            {titleBar ?? (
              <>
                <span className="size-4 shrink-0">{icon}</span>
                <span className="truncate text-[12px] text-white/85">{title}</span>
              </>
            )}
            {tracing && (
              <span className="ml-1 shrink-0 rounded-full bg-signal/15 px-2 py-0.5 font-mono text-[10px] text-signal">
                ● tracing
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-stretch">
            <Control label="Minimize" onClick={onMinimize}>
              <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
                <path d="M1 5h8" stroke="currentColor" />
              </svg>
            </Control>
            <Control label={max ? "Restore" : "Maximize"} onClick={onToggleMaximize}>
              <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
                <rect x="1" y="1" width="8" height="8" rx="1" fill="none" stroke="currentColor" />
              </svg>
            </Control>
            <Control label="Close" onClick={onClose} danger>
              <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
                <path d="m1.5 1.5 7 7m0-7-7 7" stroke="currentColor" />
              </svg>
            </Control>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">{children}</div>
      </motion.div>
    </motion.section>
  );
}
