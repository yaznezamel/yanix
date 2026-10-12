# 0004. Draw the hardware view as SVG with its own camera

- Status: accepted; how names keep their size changed in
  [0005](0005-draw-the-hardware-in-code-and-keep-zooming-cheap.md)
- Date: 2026-10-10

## Context

I asked for a zoomable hardware view in the desktop lab. It starts at the whole
machine (motherboard, CPU, RAM sticks, SSD, network controller, graphics card,
buses), goes into the CPU package, then a core, then the data path. RAM, the
SSD and the network controller get the same treatment later. The brief asks
for:

- continuous zoom and pan, and a click that flies into a part in under 500 ms
  without losing your place;
- semantic zoom (detail appears as you zoom) and a breadcrumb;
- data animated at every level, in step with the timeline, and explanations on
  hover or tap;
- illustrative labels, 60 fps, a data-driven hierarchy, and desktop and tablet
  support.

It is built in five phases, and I review each one.

PLAN.md chose React Flow and ELK for the explorer (roadmap phases 2 to 4). The
lab's map is already plain SVG animated with Motion (ADR 0002). NFR3 (keyboard,
labels), NFR9 (sources) and NFR10 (375 px, touch) apply.

## Options considered

1. **React Flow.** Pan and zoom are built in, with custom nodes. But it is
   made for graphs of nodes and edges: chip floorplans nested four levels
   deep, semantic zoom and level of detail fight it, and the trace animation
   would need a second system.
2. **PixiJS (WebGL canvas).** Handles thousands of moving particles, but text
   and accessibility need a parallel DOM, and it is one more rendering stack
   to learn.
3. **React Three Fiber.** A 3D look, but the heaviest option, and nothing here
   needs 3D.
4. **SVG with a small camera of our own, and Motion for the fly-to.** Crisp at
   any zoom. Every part is a DOM element, which helps keyboard use, screen
   readers and tests, and it reuses the lab's SVG and the prototype's
   drawings. The costs: we write the camera ourselves and keep the element
   count low.

## Decision

Option 4.

- **One SVG transform.** One camera (a centre and a zoom) maps the world to the
  screen through a single transform on a root group, so a frame of zooming or
  dragging never re-renders React.
- **Constant sizes on screen.** Labels keep their size through a CSS variable,
  `--zoom`; lines keep their width with `vector-effect: non-scaling-stroke`.
- **Level of detail.** A part shows its children once it is big enough on
  screen, and only what is on screen is drawn.
- **Fly-to.** It follows van Wijk and Nuij's smooth zoom path
  (`interpolateZoom` from d3-interpolate), takes at most 450 ms, and jumps
  straight there under reduced motion.

Three more decisions came with it:

- **The hierarchy is TypeScript data for now** (`web/lib/hardware/hierarchy.ts`),
  checked by tests. It moves to YAML with the lab's scenarios once the API
  serves content (task L.4).
- **A generic teaching PC, not a named board or chip.** Layouts are labelled
  illustrative, and no sizes or speeds appear until they can be sourced (NFR9).
  This settles the "generic teaching CPU" open decision in PLAN.md.
- **One playhead for every view:** a step index plus how far through the step
  you are. The software map, the hardware view and the timeline all read it,
  and dragging the timeline sets it, so scrubbing moves every view together,
  including in the middle of a step.

## Consequences

- **Existing traces light up the hardware unchanged.** The hardware view and
  the lab share one clock and one scenario format. Hardware activity is derived
  from the map nodes a step visits (each part names the nodes it stands for),
  so the traces did not need rewriting.
- **We own the camera code.** The camera, level of detail and picking
  (`lib/hardware/camera.ts`, `tree.ts`) are our code, with unit tests, and so
  are the wheel, pinch and drag gestures.
- **Roadmap tasks need re-planning.** Tasks 2.3 (React Flow canvas), 3.4 (ELK)
  and 3.5 (zoom transition) assumed React Flow; re-plan them against this view
  before roadmap phase 2 starts. A kernel map could still use ELK for layout
  without React Flow.
- **A way out for the deepest level.** If it needs more moving tokens than SVG
  handles at 60 fps, a canvas layer can draw just those.
- **One new dependency:** d3-interpolate, used for one function (ISC licence).
