import { APPS } from "../apps";
import { dataFrame, pipeBytes, wayland } from "../structs";
import type { AppId, Scenario, Step } from "../types";
import { drawStep, keysStep } from "./common";
import { APP_NODE } from "./launch";

// Copy and paste on Wayland. Copying moves no text at all: the app only tells
// the compositor it can supply some. Pasting creates a pipe, and the
// compositor hands its write end to the app that has the text. The kernel
// carries bytes and file descriptors; the bookkeeping is the compositor's.

const MIME = "text/plain;charset=utf-8";

const nameOf = (app: AppId) => (app === "editor" ? "the text editor" : APPS[app].name);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function copy(app: "browser" | "editor", text: string): Scenario {
  const node = APP_NODE[app];
  const name = nameOf(app);
  const Name = capital(name);
  const steps: Step[] = [keysStep("keys", node, "You press Ctrl+C", APPS[app].name)];
  if (app === "browser") {
    steps.push({
      id: "from-renderer",
      phase: "clipboard",
      path: ["renderer", "browser"],
      title: "The renderer hands over the selection",
      body: "The selected text lives in the renderer that shows the page. Renderers are sandboxed, so it sends the text to the browser process, which does all clipboard work.",
      code: [{ project: "chromium", path: "ui/ozone/platform/wayland/host/wayland_clipboard.cc" }],
      timescale: "us",
    });
  }
  steps.push(
    {
      id: "data-source",
      phase: "clipboard",
      path: [node],
      frames: [dataFrame(0, "Wayland message", "A new data source", wayland("wl_data_source.offer", [{ name: "mime_type", value: MIME }]))],
      title: "Offering the text, not sending it",
      body: `${Name} creates a Wayland data source and lists the formats it can supply, such as ${MIME}. The text itself stays in ${name}'s own memory.`,
      code:
        app === "editor"
          ? [{ project: "gtk", path: "gdk/wayland/gdkclipboard-wayland.c" }]
          : [{ project: "chromium", path: "ui/ozone/platform/wayland/host/wayland_data_device.cc" }],
      timescale: "us",
    },
    {
      id: "set-selection",
      phase: "clipboard",
      path: [node, "syscall", "ipc", "syscall", "shell"],
      frames: [
        dataFrame(
          0,
          "Wayland message",
          "“The clipboard is mine”",
          wayland("wl_data_device.set_selection", [
            { name: "source", value: "the new data source" },
            { name: "serial", value: "from your Ctrl+C key event" },
          ]),
        ),
      ],
      title: "set_selection: “the clipboard is mine”",
      body: `${Name} sends wl_data_device.set_selection over its Wayland socket, quoting the serial of your key press so the compositor can check it answers a real input event.`,
      code: [
        { project: "linux", path: "net/unix/af_unix.c", symbol: "unix_stream_sendmsg" },
        { project: "wayland", path: "protocol/wayland.xml" },
      ],
      timescale: "us",
    },
    {
      id: "owner",
      phase: "clipboard",
      path: ["shell"],
      title: "The compositor takes note",
      body: `The compositor records ${name} as the clipboard's owner, and tells whichever app has keyboard focus that a new selection is on offer, with its formats. The protocol hasn't moved a single character of the text.`,
      code: [{ project: "mutter", path: "src/wayland/meta-wayland-data-device.c" }],
      timescale: "us",
      ui: { clipboard: { owner: app, text } },
    },
    {
      id: "not-yet",
      phase: "clipboard",
      path: [node],
      title: "Copied? Not yet",
      body: `Copy only announced that ${name} can supply text; the bytes move when someone pastes. Some compositors fetch a copy straight away so the text outlives the app (GNOME's does). This model doesn't: close ${name} and the clipboard is empty.`,
      code: [{ project: "mutter", path: "src/core/meta-clipboard-manager.c" }],
    },
  );
  return { kind: "copy", app, title: "Copy", focus: "split", steps };
}

export function paste(app: "browser" | "editor", source: AppId, text: string): Scenario {
  const node = APP_NODE[app];
  const sourceNode = APP_NODE[source];
  const name = nameOf(app);
  const Name = capital(name);
  const sourceName = nameOf(source);
  const SourceName = capital(sourceName);
  const steps: Step[] = [
    keysStep("keys", node, "You press Ctrl+V", APPS[app].name),
    {
      id: "offer",
      phase: "clipboard",
      mode: "deep",
      path: ["shell", "syscall", "ipc", "syscall", node],
      frames: [dataFrame(0, "Wayland message", "Sent when the app got focus", wayland("wl_data_offer.offer", [{ name: "mime_type", value: MIME }]))],
      title: "It already knows what's on offer",
      body: `When ${name} got keyboard focus, the compositor sent it a wl_data_offer listing the clipboard's formats. So it knows text is available and picks ${MIME}.`,
      code: [{ project: "wayland", path: "protocol/wayland.xml" }],
      timescale: "us",
    },
    {
      id: "pipe",
      phase: "clipboard",
      path: [node, "syscall", "ipc"],
      title: "pipe(): a one-way channel",
      body: `${Name} creates a pipe: a small buffer in the kernel with a write end and a read end, each an open file. It keeps the read end.`,
      code: [{ project: "linux", path: "fs/pipe.c", symbol: "do_pipe2" }],
      timescale: "us",
    },
    {
      id: "receive",
      phase: "clipboard",
      path: [node, "syscall", "ipc", "syscall", "shell"],
      frames: [
        dataFrame(
          0,
          "Wayland message",
          "“Write it here”",
          wayland("wl_data_offer.receive", [
            { name: "mime_type", value: MIME },
            { name: "fd", value: "the pipe's write end, sent as SCM_RIGHTS" },
          ]),
        ),
      ],
      title: "receive(): “write it here”",
      body: `${Name} sends wl_data_offer.receive with the format and the pipe's write end. A file descriptor is just a number inside one process, so it travels as SCM_RIGHTS ancillary data on the Unix socket: the kernel installs the same open pipe in the compositor's file table.`,
      code: [
        { project: "linux", path: "net/unix/af_unix.c", symbol: "unix_stream_sendmsg" },
        { project: "linux", path: "net/core/scm.c", symbol: "__scm_send" },
        { project: "wayland", path: "src/connection.c", symbol: "wl_connection_flush" },
      ],
      timescale: "us",
    },
    {
      id: "send",
      phase: "clipboard",
      path: ["shell", "syscall", "ipc", "syscall", sourceNode],
      frames: [
        dataFrame(
          0,
          "Wayland message",
          "Forwarded to the owner",
          wayland("wl_data_source.send", [
            { name: "mime_type", value: MIME },
            { name: "fd", value: "the same pipe's write end" },
          ]),
        ),
      ],
      title: "The compositor passes it on",
      body: `The compositor doesn't fetch the text either. It forwards the request to ${sourceName}, the owner, as a wl_data_source.send event, passing the same pipe along.`,
      code: [{ project: "mutter", path: "src/wayland/meta-wayland-data-device.c" }],
      timescale: "us",
    },
    {
      id: "write",
      phase: "clipboard",
      path: [sourceNode, "syscall", "ipc"],
      frames: [dataFrame(2, "Pipe", "In the pipe's buffer", pipeBytes(text))],
      title: `${SourceName} writes the text`,
      body: `${SourceName} write()s the text into the pipe and closes its end. The kernel copies the bytes into the pipe's buffer and wakes up whoever waits on the read end.`,
      code: [{ project: "linux", path: "fs/pipe.c", symbol: "anon_pipe_write" }],
      timescale: "us",
    },
    {
      id: "read",
      phase: "clipboard",
      path: ["ipc", "syscall", node],
      frames: [dataFrame(0, "Pipe", "Read until end of file", pipeBytes(text))],
      title: "Read until end of file",
      body: `${Name} read()s from its end until read() returns 0. Zero means the writer closed the pipe, so that's all of it.`,
      code: [{ project: "linux", path: "fs/pipe.c", symbol: "anon_pipe_read" }],
      timescale: "us",
    },
  ];
  if (app === "browser") {
    steps.push(
      {
        id: "to-renderer",
        phase: "clipboard",
        path: ["browser", "renderer"],
        title: "Into the search box",
        body: "The browser process sends the text to the renderer of the focused tab, which inserts it into the search box like typed text.",
        code: [{ project: "chromium", path: "mojo/" }],
        timescale: "us",
      },
      drawStep("show", "renderer", "The text appears", "The renderer paints the search box again and the compositor shows the new frame.", {
        draftInsert: text,
      }),
    );
  } else {
    steps.push(
      drawStep("show", "editor", "The text appears", "The editor inserts the text at the cursor, draws the changed lines and the compositor shows the new frame.", {
        editorInsert: text,
      }),
    );
  }
  steps.push({
    id: "paste-done",
    phase: "clipboard",
    path: ["ipc"],
    title: "Copy and paste, explained",
    body: `The kernel only carried bytes: a pipe for the text, Unix sockets for the messages and the file descriptor. Which app owns the clipboard is the compositor's business, and until now the text lived only in ${sourceName}.`,
  });
  return { kind: "paste", app, title: "Paste", focus: "split", steps };
}
