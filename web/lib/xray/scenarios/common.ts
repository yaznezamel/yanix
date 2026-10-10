import type { CodeRef, NodeId, Step } from "../types";

// Pieces several scenarios share. Every action starts as input, so the input
// path has a one-step summary here; the keystroke scenario walks it in full.

/** From the keyboard or mouse to the compositor. */
export const INPUT_PATH: NodeId[] = ["inputdev", "usbhc", "irq", "usbdrv", "input", "syscall", "shell"];

const INPUT_CODE: CodeRef[] = [
  { project: "linux", path: "drivers/usb/host/xhci-ring.c", symbol: "xhci_irq" },
  { project: "linux", path: "drivers/hid/hid-input.c", symbol: "hidinput_hid_event" },
  { project: "linux", path: "drivers/input/evdev.c", symbol: "evdev_read" },
];

/** Key presses that end in an app, as one overview step. */
export function keysStep(id: string, target: NodeId, title: string, appName: string): Step {
  return {
    id,
    phase: "input",
    path: [...INPUT_PATH, target],
    title,
    body: `The keys take the input path: the USB controller collects the keyboard's report and interrupts the CPU, the HID driver turns it into key events, evdev hands them to the compositor, and the compositor sends them to the focused ${appName} window over its Wayland connection.`,
    code: INPUT_CODE,
    timescale: "ms",
  };
}

/** A click that ends in the compositor or an app, as one overview step. */
export function clickStep(id: string, target: NodeId, title: string, what: string): Step {
  return {
    id,
    phase: "input",
    path: target === "shell" ? INPUT_PATH : [...INPUT_PATH, target],
    title,
    body: `The click takes the input path: the USB controller collects the mouse's report and interrupts the CPU, the HID driver turns it into a button event, and the compositor, which reads it from evdev, finds ${what} under the pointer.`,
    code: INPUT_CODE,
    timescale: "ms",
  };
}

/** A new frame on screen: GPU work, then the compositor flips to it. */
export function drawStep(id: string, from: NodeId, title: string, body: string, ui?: Step["ui"]): Step {
  return {
    id,
    phase: "render",
    path: [from, "syscall", "drm", "display"],
    title,
    body,
    code: [
      { project: "linux", path: "drivers/gpu/drm/drm_ioctl.c" },
      { project: "linux", path: "drivers/gpu/drm/drm_atomic_uapi.c", symbol: "drm_mode_atomic_ioctl" },
    ],
    timescale: "ms",
    ui,
  };
}
