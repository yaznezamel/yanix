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

/** Characters typed with Shift held on a US layout: capitals and the shifted symbols. */
const SHIFTED = /[A-Z~!@#$%^&*()_+{}|:"<>?]/g;

/**
 * The USB reports a keyboard sends for some typed text and Enter: one when a
 * key goes down and one when it comes up, and Shift's own two for each
 * shifted character, typed one at a time.
 */
export function keyReports(text: string): number {
  return 2 * ([...text].length + 1) + 2 * (text.match(SHIFTED)?.length ?? 0);
}

/**
 * Key presses that end in an app, as one overview step. `typed` is the text
 * before the Enter that ends it, for the reports it takes.
 */
export function keysStep(id: string, target: NodeId, title: string, appName: string, typed = ""): Step {
  const reports = keyReports(typed);
  return {
    id,
    phase: "input",
    path: [...INPUT_PATH, target],
    title,
    body: `The keys take the input path: the USB controller collects the keyboard's report and interrupts the CPU, the HID driver turns it into key events, evdev hands them to the compositor, and the compositor sends them to the focused ${appName} window over its Wayland connection.`,
    code: INPUT_CODE,
    timescale: "ms",
    data: {
      amount: `${reports * 8} bytes`,
      what: `${reports} USB keyboard reports of 8 bytes (the HID boot format): one each time a key goes down or comes up. evdev passes each change on as 3 events of 24 bytes.`,
    },
    aws: {
      service: "Amazon EventBridge",
      text: "The compositor routes each key event to one target, the window with keyboard focus, much as an EventBridge rule matches an event and delivers it to its target. Here the rule is simply: whichever window you clicked last.",
    },
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
    data: {
      amount: "2 × 3 bytes",
      what: "the mouse's reports for the button going down and coming up: buttons, x and y movement, 3 bytes each in the HID boot format (many mice add a wheel byte)",
    },
    aws: {
      service: "Amazon EventBridge",
      text: "The compositor matches the click to whatever is under the pointer and delivers it there, as an EventBridge rule matches an event to its target by pattern. Here the pattern is the pointer's position.",
    },
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
