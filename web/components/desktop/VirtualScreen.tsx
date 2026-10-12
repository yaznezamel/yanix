"use client";

import { MotionConfig } from "motion/react";
import { useEffect, useRef, useState } from "react";

export const SCREEN = { width: 960, height: 600 } as const;

/**
 * Renders its children on a fixed 960 x 600 "screen" and scales it to fit the
 * available width, like a picture of a monitor. Dragging inside still follows
 * the pointer because Motion is told about the scale.
 */
export function VirtualScreen({ children }: { children: React.ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / SCREEN.width);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      className="relative w-full overflow-hidden rounded-md bg-black"
      style={{ aspectRatio: `${SCREEN.width} / ${SCREEN.height}` }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: SCREEN.width, height: SCREEN.height, transform: `scale(${scale})` }}
      >
        <MotionConfig transformPagePoint={(p) => ({ x: p.x / scale, y: p.y / scale })}>
          {children}
        </MotionConfig>
      </div>
    </div>
  );
}
