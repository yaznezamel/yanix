import {
  dataFrame,
  hidReport,
  inputEvent,
  keyInfo,
  keyLabel,
  mscScan,
  synReport,
  usbTransfer,
  waylandKey,
} from "../structs";
import type { Scenario, Step } from "../types";
import { drawStep } from "./common";

// One key press, all the way: the keyboard's report, the USB controller, an
// interrupt, three kernel drivers, evdev, the compositor, a Wayland message
// over a Unix socket, and the app that finally turns a key code into a letter.

const hex = (n: number) => `0x${n.toString(16).padStart(2, "0")}`;

export function keystroke(app: "browser" | "editor", key: string): Scenario {
  const info = keyInfo(key);
  const label = keyLabel(key);
  const appName = app === "browser" ? "Chromium" : "the text editor";
  const AppName = app === "browser" ? "Chromium" : "The text editor";
  const usage = info ? `${hex(info.usage)}, “Keyboard ${label}”,` : "The key's usage ID";
  const code = info ? `${info.name} (${info.code})` : "its Linux key code";
  const codeNumber = info ? String(info.code) : "the key code";
  const keysym = key === " " ? "space" : key;
  const modifiers = info?.shift ? "with Shift held" : "with no modifiers";
  const target = app === "browser" ? "browser" : "editor";

  const steps: Step[] = [
    {
      id: "key-down",
      phase: "input",
      path: ["inputdev"],
      frames: [dataFrame(0, "HID report", "What the keyboard will send", hidReport(key))],
      title: `You press “${label}”`,
      body: "Under the key, a switch closes. The keyboard's own small controller scans its grid of keys, notices the change and prepares a report: often an 8-byte message listing the keys now held down. It can't send it on its own: on USB, the computer has to ask.",
      timescale: "ms",
    },
    {
      id: "usb-poll",
      phase: "input",
      path: ["inputdev", "usbhc", "ram"],
      frames: [dataFrame(0, "USB transfer", "The report crosses the USB cable", usbTransfer, hidReport(key))],
      title: "The USB controller asks",
      body: "The USB host controller in the chipset polls the keyboard at the interval the keyboard asked for, every few milliseconds or faster. This time there's a report, and the controller writes it into a buffer in RAM with DMA.",
      timescale: "ms",
      data: {
        amount: "8 bytes",
        what: "the report, copied into a buffer in RAM by DMA. How often the controller asks is the keyboard's choice, set by bInterval in its endpoint descriptor.",
      },
      aws: {
        service: "AWS Lambda and Amazon SQS",
        text: "A keyboard can't push, so the host asks on a schedule. Lambda reads an SQS queue the same way: its event source mapping polls the queue for you and invokes your function only when messages are there, as the controller interrupts the CPU only when there is a report.",
      },
    },
    {
      id: "usb-irq",
      phase: "input",
      path: ["usbhc", "cpu", "irq"],
      title: "An interrupt",
      body: "The controller adds an entry to its event ring in RAM and raises an interrupt: an MSI, a small memory write that the CPU's interrupt controller turns into a signal. The core that receives it stops what it was doing, saves its place and jumps into the kernel.",
      code: [
        { project: "linux", path: "kernel/irq/handle.c" },
        { project: "linux", path: "drivers/usb/host/xhci-ring.c", symbol: "xhci_irq" },
      ],
      timescale: "us",
    },
    {
      id: "xhci",
      phase: "input",
      mode: "deep",
      path: ["irq", "usbdrv"],
      title: "The xHCI driver",
      body: "xhci_irq() walks the event ring, finds the finished transfer and completes its URB, the kernel's record of a USB transfer. Completing it calls the HID driver back.",
      code: [
        { project: "linux", path: "drivers/usb/host/xhci-ring.c", symbol: "handle_tx_event" },
        { project: "linux", path: "drivers/usb/core/hcd.c", symbol: "usb_hcd_giveback_urb" },
      ],
      timescale: "us",
    },
    {
      id: "hid",
      phase: "input",
      path: ["irq", "usbdrv"],
      frames: [dataFrame(0, "HID report", "Parsed with the keyboard's descriptor", hidReport(key))],
      title: "From report to key code",
      body: `usbhid hands the 8 bytes to the HID core, which reads them with the layout the keyboard described when it was plugged in (its report descriptor). ${usage} becomes the Linux key code ${code}.`,
      code: [
        { project: "linux", path: "drivers/hid/usbhid/hid-core.c", symbol: "hid_irq_in" },
        { project: "linux", path: "drivers/hid/hid-core.c", symbol: "hid_input_report" },
        { project: "linux", path: "drivers/hid/hid-input.c", symbol: "hidinput_hid_event" },
      ],
      timescale: "us",
      aws: {
        service: "AWS Glue Schema Registry",
        text: "The keyboard describes its report's layout once, when it's plugged in, and every report after that is read with it. A schema registry does the same for streaming data: producers register a record's layout once, and consumers decode each record with it.",
      },
    },
    {
      id: "evdev",
      phase: "input",
      path: ["usbdrv", "input"],
      frames: [
        dataFrame(0, "HID report", "Parsed with the keyboard's descriptor", hidReport(key)),
        dataFrame(1, "Input event", "What evdev queues for each reader", mscScan(key), inputEvent(key), synReport),
      ],
      title: "An input event",
      body: "hid-input calls input_event() twice: the scan code (MSC_SCAN), then the key itself. Every handler attached to the keyboard gets them; evdev, the one behind /dev/input/event*, timestamps each and queues it as a 24-byte struct input_event for every program that has the device open, then a SYN_REPORT that closes the batch and wakes the readers.",
      code: [
        { project: "linux", path: "drivers/input/input.c", symbol: "input_event" },
        { project: "linux", path: "drivers/input/evdev.c", symbol: "evdev_events" },
      ],
      timescale: "us",
      aws: {
        service: "Amazon SNS",
        text: "evdev keeps a separate queue for each program that opened the device, and each gets its own copy of every event. That is SNS fan-out: one message published to a topic, delivered to every SQS queue subscribed to it.",
      },
    },
    {
      id: "wake-compositor",
      phase: "compositor",
      mode: "deep",
      path: ["input", "sched"],
      title: "The compositor wakes up",
      body: "The compositor's input thread sleeps in epoll_wait() on the event file. The SYN_REPORT makes it runnable, and the scheduler gives it a core.",
      code: [
        { project: "linux", path: "fs/eventpoll.c", symbol: "ep_poll" },
        { project: "linux", path: "kernel/sched/core.c", symbol: "try_to_wake_up" },
      ],
      timescale: "us",
    },
    {
      id: "libinput",
      phase: "compositor",
      path: ["input", "syscall", "shell"],
      frames: [dataFrame(0, "Input event", "read() from /dev/input/event*", mscScan(key), inputEvent(key), synReport)],
      title: "The compositor reads it",
      body: "The compositor reads the queued events through libinput, which keeps track of which keys are down and passes the key press on.",
      code: [{ project: "linux", path: "drivers/input/evdev.c", symbol: "evdev_read" }],
      timescale: "us",
    },
    {
      id: "focus",
      phase: "compositor",
      path: ["shell"],
      title: "Which window gets it?",
      body: `The compositor updates its own keyboard state with xkbcommon (is Shift held?), checks whether the key is one of its shortcuts, and finds the window with keyboard focus: ${appName}.`,
      code: [
        { project: "libxkbcommon", path: "src/state.c", symbol: "xkb_state_update_key" },
        { project: "mutter", path: "src/wayland/meta-wayland-keyboard.c" },
      ],
      timescale: "us",
      aws: {
        service: "Amazon EventBridge",
        text: "The compositor works like an event bus with two rules: if the key is one of its own shortcuts, it handles it; otherwise it delivers the event to a single target, the window with keyboard focus.",
      },
    },
    {
      id: "wl-key",
      phase: "compositor",
      path: ["shell", "syscall", "ipc", "syscall", target],
      frames: [dataFrame(0, "Wayland message", "wl_keyboard.key on the app's socket", waylandKey(key))],
      title: "A Wayland event over a Unix socket",
      body: `The compositor writes a wl_keyboard.key event to ${appName}'s Wayland connection, a Unix domain socket: a serial number, a time, key ${codeNumber}, pressed. It sends the key code, not a letter: each app turns codes into characters with the keymap the compositor shared when it connected.`,
      code: [
        { project: "linux", path: "net/unix/af_unix.c", symbol: "unix_stream_sendmsg" },
        { project: "wayland", path: "protocol/wayland.xml" },
      ],
      timescale: "us",
      aws: {
        service: "Amazon S3 event notifications",
        text: "The event carries a key code, not a letter, and each app looks up what it means in the keymap it got when it connected. An S3 event notification works the same way: it names the bucket and the object's key, and the receiver fetches the object only if it needs it.",
      },
    },
    app === "browser"
      ? {
          id: "xkb",
          phase: "app",
          path: ["browser"],
          title: `Key ${codeNumber} becomes “${label}”`,
          body: `Chromium's browser process reads the event and runs it through xkbcommon with the compositor's keymap, adding 8 to the code as Wayland's xkb keymaps require. Key ${codeNumber} ${modifiers} gives the keysym ${keysym}.`,
          code: [
            { project: "chromium", path: "ui/ozone/platform/wayland/host/wayland_keyboard.cc" },
            { project: "chromium", path: "ui/events/ozone/layout/xkb/xkb_keyboard_layout_engine.cc" },
          ],
          timescale: "us",
        }
      : {
          id: "xkb",
          phase: "app",
          path: ["editor"],
          title: `Key ${codeNumber} becomes “${label}”`,
          body: `GTK reads the event and runs it through xkbcommon with the compositor's keymap, adding 8 to the code as Wayland's xkb keymaps require. Key ${codeNumber} ${modifiers} gives the keysym ${keysym}.`,
          code: [
            { project: "gtk", path: "gdk/wayland/gdkseat-wayland.c", symbol: "keyboard_handle_key" },
            { project: "libxkbcommon", path: "src/state.c", symbol: "xkb_state_key_get_one_sym" },
          ],
          timescale: "us",
        },
  ];

  if (app === "browser") {
    steps.push(
      {
        id: "to-renderer",
        phase: "app",
        path: ["browser", "renderer"],
        title: "To the tab's renderer",
        body: "The browser process wraps the key in a keyboard event and sends it over Mojo IPC to the renderer of the focused tab, the process that owns the search box.",
        code: [{ project: "chromium", path: "mojo/" }],
        timescale: "us",
      },
      {
        id: "dom",
        phase: "app",
        mode: "deep",
        path: ["renderer"],
        title: "keydown, input, keyup",
        body: "In the renderer, the page sees a keydown event, then beforeinput and input as the character goes into the search box. JavaScript could react here, for example to suggest searches.",
        code: [{ project: "chromium", path: "third_party/blink/renderer/core/editing/" }],
        timescale: "us",
      },
      drawStep(
        "paint",
        "renderer",
        `“${label}” appears`,
        "The renderer lays out and paints the changed text, the GPU draws it, and the compositor shows the new frame at the display's next refresh.",
      ),
    );
  } else {
    steps.push(
      {
        id: "insert",
        phase: "app",
        path: ["editor"],
        title: "Into the document",
        body: "The text view inserts the character into its buffer at the cursor, moves the cursor on and marks the line to be drawn again.",
        timescale: "us",
      },
      drawStep(
        "paint",
        "editor",
        `“${label}” appears`,
        "GTK draws the changed line with the GPU and hands the new frame to the compositor, which shows it at the display's next refresh.",
      ),
    );
  }

  steps.push(
    {
      id: "key-up",
      phase: "input",
      mode: "deep",
      path: ["inputdev", "usbhc", "irq", "usbdrv", "input"],
      frames: [
        dataFrame(0, "HID report", "All keys up", hidReport(key, false)),
        dataFrame(3, "Input event", "The release", mscScan(key), inputEvent(key, false), synReport),
      ],
      title: "You let go",
      body: `Releasing the key sends a new report with the slot empty, and the same path delivers ${code} with value 0, released. Hold a key down instead and the keyboard sends nothing new: the app repeats the key itself, at the rate the compositor announced.`,
      code: [{ project: "linux", path: "drivers/input/input.c", symbol: "input_event" }],
      timescale: "ms",
    },
    {
      id: "key-done",
      phase: "app",
      path: [target],
      title: "One key, start to finish",
      body: `A microcontroller, the USB controller, an interrupt, the xHCI, HID and input layers, the compositor, a Unix socket and ${appName}: all of it for one character, every time you press a key. ${AppName} never touched the hardware.`,
    },
  );

  return {
    kind: "keystroke",
    app,
    title: `Typing “${label}”`,
    focus: "screen",
    steps,
  };
}
