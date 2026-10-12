"use client";

import { useCallback, useRef, useState } from "react";

// A text box that scrolls says when there is more below the fold: a short
// fade over its last line, and a "More" button outside it, so the button
// never covers what you are reading.

/** Smooth scrolling, unless the reader asked for less motion. */
export const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

/** Watches a scrolling text box: is there more below the fold? */
export function useMoreCue() {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);
  const watch = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el;
    if (!el) return;
    const update = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 6);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);
  const scrollDown = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollBy({ top: el.clientHeight * 0.75, behavior: scrollBehavior() });
  }, []);
  /** Scrolls the box, and only the box, until an element inside it is at the top. */
  const reveal = useCallback((target: HTMLElement | null) => {
    const el = scroller.current;
    if (!el || !target) return;
    const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 4;
    el.scrollTo({ top, behavior: scrollBehavior() });
  }, []);
  return { watch, more, scrollDown, reveal };
}

/** The fade over the bottom of a box that scrolls; its container must be relative. */
export function MoreFade() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-lab-panel to-transparent"
    />
  );
}

export function MoreButton({ onMore }: { onMore: () => void }) {
  return (
    <button
      type="button"
      onClick={onMore}
      className="shrink-0 rounded-full border border-lab-line bg-lab-panel2 px-2.5 py-1 text-[11.5px] leading-none text-lab-ink shadow-md hover:border-white/30"
    >
      More ↓
    </button>
  );
}
