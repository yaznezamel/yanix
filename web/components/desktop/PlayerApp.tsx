"use client";

import { useState } from "react";
import { MEDIA } from "@/lib/xray/apps";
import type { Media, MediaState } from "@/lib/xray/types";
import styles from "../lab/lab.module.css";
import { PlayerIcon } from "./icons";

interface PlayerAppProps {
  state: MediaState;
  /** A play trace is running; the controls wait for it. */
  busy: boolean;
  onPlay: (media: Media) => void;
  onPause: () => void;
}

const ORDER: Media[] = ["audio", "video"];

function Visual({ media, playing }: { media: Media; playing: boolean }) {
  if (media === "video") {
    return (
      <div className={`relative h-full w-full overflow-hidden ${styles.sky} ${playing ? styles.running : ""}`}>
        <div className={`${styles.sun} ${playing ? styles.running : ""}`} />
        <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-[#0b1220] to-[#16213a]" />
      </div>
    );
  }
  return (
    <div className="flex h-full w-full items-end justify-center gap-1.5 bg-gradient-to-b from-[#0d1b2a] to-[#123a4a] pb-8">
      {Array.from({ length: 18 }, (_, i) => (
        <span
          key={i}
          className={`w-2.5 rounded-t bg-[#5eead4]/80 ${styles.eq} ${playing ? styles.running : ""}`}
          style={{ height: `${18 + ((i * 37) % 60)}%`, animationDelay: `${(i % 6) * -0.17}s` }}
        />
      ))}
    </div>
  );
}

export function PlayerApp({ state, busy, onPlay, onPause }: PlayerAppProps) {
  const [selected, setSelected] = useState<Media>(state.media);
  const shown = state.playing || busy ? state.media : selected;
  const playing = state.playing;

  return (
    <div className="flex h-full bg-[#141519] text-white">
      <aside className="flex w-48 shrink-0 flex-col gap-1 border-r border-white/10 bg-[#1b1c21] p-2 text-[12px]">
        <p className="px-2 pb-1 pt-1 text-[10.5px] uppercase tracking-[0.12em] text-white/40">Library</p>
        {ORDER.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setSelected(m)}
            disabled={busy || playing}
            aria-pressed={shown === m}
            className={`flex flex-col rounded-md px-2 py-1.5 text-left disabled:cursor-default ${
              shown === m ? "bg-white/[0.1]" : "hover:bg-white/[0.06]"
            }`}
          >
            <span className="font-medium text-white/90">{MEDIA[m].title}</span>
            <span className="text-[10.5px] text-white/45">{MEDIA[m].kind}</span>
          </button>
        ))}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 bg-black">
          <Visual media={shown} playing={playing} />
          {!playing && (
            <div className="absolute inset-0 grid place-items-center bg-black/35">
              <PlayerIcon className="size-14 opacity-80" />
            </div>
          )}
          {state.status && (
            <span className="absolute left-3 top-3 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white/80">
              {state.status}
            </span>
          )}
        </div>
        <div className="flex h-12 shrink-0 items-center gap-3 border-t border-white/10 px-3">
          <button
            type="button"
            onClick={() => (playing ? onPause() : onPlay(shown))}
            disabled={busy}
            aria-label={playing ? "Pause" : "Play"}
            className="grid size-8 place-items-center rounded-full bg-white text-[#141519] hover:brightness-90 disabled:opacity-40"
          >
            {playing ? (
              <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
                <rect x="3.5" y="3" width="3" height="10" fill="currentColor" />
                <rect x="9.5" y="3" width="3" height="10" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
                <path d="M4.5 3v10l8-5z" fill="currentColor" />
              </svg>
            )}
          </button>
          <div className="relative h-1 flex-1 overflow-hidden rounded bg-white/15">
            <div className={`absolute inset-y-0 left-0 bg-[#5eead4] ${styles.progress} ${playing ? styles.running : ""}`} />
          </div>
          <span className="w-28 truncate text-right text-[11px] text-white/55">{MEDIA[shown].title}</span>
        </div>
      </div>
    </div>
  );
}
