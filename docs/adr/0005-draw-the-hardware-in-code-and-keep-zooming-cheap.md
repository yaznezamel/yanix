# 0005. Draw the hardware in code, and keep zooming cheap

- Status: accepted
- Date: 2026-10-11

## Context

Phase H.2 of the hardware view ([ADR 0004](0004-draw-the-hardware-view-as-svg-with-its-own-camera.md))
turns its plain boxes into hardware: the motherboard and what is on it, the CPU
package with its lid and die, the devices outside the case. The brief asks for
a hardware look (FR1), semantic zoom (FR4), illustrative labels (FR10) and 60
fps (NFR1), and the hierarchy must stay data that can move to YAML (NFR4).

The first version of the drawings made zooming slow. With Chrome's CPU slowed
four times, flying into the CPU ran at 16 to 23 fps, with frames of up to
280 ms. A trace showed where the time went: recomputing styles and layout
across the whole drawing on every frame, and hit-testing it.

## Options considered

For the drawings:

1. **Image files** (SVG or PNG per part). Easy to make in a drawing tool, but
   they blur or weigh a lot when zoomed, cannot light up per part, and do not
   follow the data.
2. **Drawings in code, picked by a `look` in the data.** Each part names how
   it is drawn (`cpu`, `dimm`, `logic`, `sram`…); textures such as a die's
   logic come from a seeded generator, so they are the same on every visit.
   Crisp at any zoom and driven by the hierarchy, but every drawing is code.

For speed:

1. **Fewer shapes.** Helps a little; the cost was per frame, not per shape.
2. **Change what each frame touches.** Keep zooming to one transform, and
   move everything else that changed per frame out of the drawing's way.

## Decision

Drawings in code, picked by `look`, with no SVG filters and each texture a
few paths. A part's insides are drawn under a cover (a CPU's lid, a chipset's
heatsink) that fades out as the insides fade in; a part with no cover shows
its insides' drawings until they are fully shown. The writing on the hardware
uses a small stroke font, as board design tools do for silkscreen.

For speed, each frame of a zoom now changes only the drawing's transform, the
names' layer and a few opacities:

- **Names live in a layer of their own**, outside the zoomed group, placed by
  three CSS variables set on that layer alone. A zoom variable on the whole
  SVG made the browser recompute the style of every shape on every frame.
- **No SVG text inside the zoomed group.** The browser lays SVG text out again
  whenever the scale above it changes; six words on the lid and the board cost
  most of a frame's layout. Hence the stroke font.
- **Fading groups get their opacity from code**, not from a CSS variable.
- **A clear pane over the drawing takes the pointer.** The view already finds
  the part under the pointer itself (`pickAt`); now the browser no longer
  searches thousands of shapes on every frame, which it did to update hover.
- **The drawing renders in the background** (`useDeferredValue`), and a part
  is drawn again only when it or a part inside it changes.

## Consequences

- With the CPU slowed four times, fly-ins run at 45 to 51 fps, wheel zoom at
  50 to 54 and dragging at 60, with no frame over 50 ms; unslowed, everything
  holds 60 fps (Chromium, 1440 × 900, production build). That is faster than
  before the drawings.
- On a slow machine, a part's insides can appear a moment after the camera
  arrives.
- New writing on the hardware needs its letters in the stroke font
  (`lib/hardware/strokeFont.ts`); a test checks every character used.
- Parts are not hit by the pointer, so hover is drawn by code, and a part's
  `onClick` only serves assistive technology.
- Revisit if H.3's animated data path needs many moving tokens: ADR 0004
  already allows a canvas layer for those.
