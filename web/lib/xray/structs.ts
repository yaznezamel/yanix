import type { Header, PacketFrame } from "./types";

// Builders for the data that moves between layers outside the network: USB
// reports, input events, Wayland messages, NVMe commands, ELF headers, memory
// maps and audio buffers. Values follow the specifications and kernel headers
// cited next to each builder; anything that varies per machine says so.

/** A frame for the data panel with its own heading, e.g. "Input event". */
export function dataFrame(at: number, label: string, caption: string, ...headers: Header[]): PacketFrame {
  return { at, packet: { label, caption, headers } };
}

// ---------------------------------------------------------------- keyboard

interface KeyInfo {
  /** HID usage ID on the Keyboard/Keypad page (USB HID Usage Tables, 0x07). */
  usage: number;
  /** Linux key code from include/uapi/linux/input-event-codes.h. */
  code: number;
  name: string;
  shift: boolean;
}

const LETTER_CODES: Record<string, number> = {
  q: 16, w: 17, e: 18, r: 19, t: 20, y: 21, u: 22, i: 23, o: 24, p: 25,
  a: 30, s: 31, d: 32, f: 33, g: 34, h: 35, j: 36, k: 37, l: 38,
  z: 44, x: 45, c: 46, v: 47, b: 48, n: 49, m: 50,
};

/** Usage and key code for a typed character, or null for keys this model doesn't map. */
export function keyInfo(char: string): KeyInfo | null {
  if (char.length !== 1) return null;
  const lower = char.toLowerCase();
  if (lower >= "a" && lower <= "z") {
    const code = LETTER_CODES[lower];
    if (code === undefined) return null;
    return {
      usage: 0x04 + (lower.charCodeAt(0) - 97),
      code,
      name: `KEY_${lower.toUpperCase()}`,
      shift: char !== lower,
    };
  }
  if (char >= "1" && char <= "9") {
    const n = Number(char);
    return { usage: 0x1e + n - 1, code: 2 + n - 1, name: `KEY_${char}`, shift: false };
  }
  if (char === "0") return { usage: 0x27, code: 11, name: "KEY_0", shift: false };
  if (char === " ") return { usage: 0x2c, code: 57, name: "KEY_SPACE", shift: false };
  return null;
}

const hex = (n: number) => `0x${n.toString(16).padStart(2, "0")}`;

export function keyLabel(char: string): string {
  return char === " " ? "Space" : char;
}

/** The 8-byte boot-protocol report many keyboards send (HID 1.11, appendix B). */
export function hidReport(char: string, pressed = true): Header {
  const info = keyInfo(char);
  if (!pressed) {
    return {
      kind: "hid",
      title: "HID report (key up)",
      bytes: 8,
      fields: [
        { name: "Modifiers", value: "0x00" },
        { name: "Keys", value: "none: every slot 0x00" },
      ],
    };
  }
  return {
    kind: "hid",
    title: "HID report",
    bytes: 8,
    fields: [
      { name: "Modifiers", value: info?.shift ? "0x02 (left Shift)" : "0x00 (none)" },
      {
        name: "Keys",
        value: info
          ? `${hex(info.usage)} (“${keyLabel(char)}”) in slot 1 of 6`
          : "the key's usage ID in slot 1 of 6",
      },
      { name: "Format", value: "boot protocol: modifiers, reserved, 6 key slots" },
    ],
  };
}

export const usbTransfer: Header = {
  kind: "usb",
  title: "USB interrupt transfer",
  fields: [
    { name: "Endpoint", value: "interrupt IN, polled by the host" },
    { name: "Length", value: "8 bytes" },
  ],
};

/** struct input_event: 24 bytes on 64-bit (include/uapi/linux/input.h). */
export function inputEvent(char: string, pressed = true): Header {
  const info = keyInfo(char);
  return {
    kind: "evdev",
    title: "struct input_event",
    bytes: 24,
    fields: [
      { name: "time", value: "seconds and microseconds" },
      { name: "type", value: "EV_KEY (1)" },
      { name: "code", value: info ? `${info.name} (${info.code})` : "the key's code" },
      { name: "value", value: pressed ? "1 (pressed)" : "0 (released)" },
    ],
  };
}

/**
 * The scan code hid-input reports just before each key change: the key's HID
 * usage, with its page (0x07) in the top 16 bits (drivers/hid/hid-input.c,
 * hidinput_hid_event()).
 */
export function mscScan(char: string): Header {
  const info = keyInfo(char);
  return {
    kind: "evdev",
    title: "struct input_event (scan code)",
    bytes: 24,
    fields: [
      { name: "type", value: "EV_MSC (4)" },
      { name: "code", value: "MSC_SCAN (4)" },
      {
        name: "value",
        value: info ? `0x7${info.usage.toString(16).padStart(4, "0")}: HID page 0x07, usage ${hex(info.usage)}` : "the key's HID usage",
      },
    ],
  };
}

export const synReport: Header = {
  kind: "evdev",
  title: "struct input_event (sync)",
  bytes: 24,
  fields: [
    { name: "type", value: "EV_SYN (0)" },
    { name: "code", value: "SYN_REPORT (0): end of this batch" },
  ],
};

/** A Wayland message: 8-byte header (object id, size and opcode) plus arguments. */
export function wayland(title: string, fields: Header["fields"], bytes?: number): Header {
  return { kind: "wayland", title, fields, bytes };
}

export function waylandKey(char: string, pressed = true): Header {
  const info = keyInfo(char);
  return wayland(
    "wl_keyboard.key",
    [
      { name: "Event", value: "key, opcode 3 of wl_keyboard" },
      { name: "serial", value: "a number the app can quote back later" },
      { name: "time", value: "milliseconds" },
      { name: "key", value: info ? `${info.code} (${info.name}), not a letter` : "the key code, not a letter" },
      { name: "state", value: pressed ? "pressed" : "released" },
    ],
    24,
  );
}

// ---------------------------------------------------------------- storage

/** NVMe read: a 64-byte submission queue entry (NVMe base specification). */
export const nvmeRead: Header = {
  kind: "nvme",
  title: "NVMe read command",
  bytes: 64,
  fields: [
    { name: "Opcode", value: "0x02 (Read)" },
    { name: "Namespace", value: "1" },
    { name: "Start LBA", value: "the block ext4 found" },
    { name: "Blocks", value: "one page: 8 blocks of 512 bytes or 1 of 4,096, by format" },
    { name: "Data pointer", value: "PRP1: physical address of the page-cache page" },
  ],
};

export const nvmeCompletion: Header = {
  kind: "nvme",
  title: "NVMe completion",
  bytes: 16,
  fields: [
    { name: "Command", value: "matches the read's identifier" },
    { name: "Status", value: "0: success" },
  ],
};

// ---------------------------------------------------------------- programs

export function elfHeader(program: string): Header {
  return {
    kind: "elf",
    title: "ELF header",
    bytes: 64,
    fields: [
      { name: "Magic", value: "7f 45 4c 46 (“\\x7fELF”)" },
      { name: "Class", value: "64-bit, little-endian" },
      { name: "Type", value: "DYN: position-independent, loads at any address" },
      { name: "Machine", value: "x86-64" },
      { name: "File", value: program },
    ],
  };
}

export const programHeaders: Header = {
  kind: "elf",
  title: "Program headers",
  fields: [
    { name: "INTERP", value: "/lib64/ld-linux-x86-64.so.2" },
    { name: "LOAD", value: "code: read and execute" },
    { name: "LOAD", value: "data: read and write" },
    { name: "DYNAMIC", value: "the libraries it needs, and more" },
  ],
};

/** One mapping, as a line of /proc/PID/maps would show it. */
export function vma(title: string, perms: string, backing: string): Header {
  return {
    kind: "vma",
    title,
    fields: [
      { name: "Permissions", value: perms },
      { name: "Backed by", value: backing },
    ],
  };
}

// ---------------------------------------------------------------- audio

export function pcm(rate: string, note: string): Header {
  return {
    kind: "pcm",
    title: "Audio samples (PCM)",
    fields: [
      { name: "Rate", value: rate },
      { name: "Channels", value: "2 (stereo)" },
      { name: "Format", value: note },
    ],
  };
}

// ---------------------------------------------------------------- power

/** PM1 control register write: SLP_TYP in bits 10-12, SLP_EN in bit 13 (ACPI). */
export const pm1Control: Header = {
  kind: "reg",
  title: "PM1 control register",
  fields: [
    { name: "SLP_TYP", value: "the S5 value from the firmware's \\_S5 object" },
    { name: "SLP_EN", value: "1 (bit 13): enter that state now" },
  ],
};

export function dbusCall(member: string, args: string): Header {
  return {
    kind: "dbus",
    title: "D-Bus method call",
    fields: [
      { name: "Destination", value: "org.freedesktop.login1" },
      { name: "Method", value: `org.freedesktop.login1.Manager.${member}` },
      { name: "Arguments", value: args },
    ],
  };
}

// ---------------------------------------------------------------- clipboard

export function pipeBytes(text: string): Header {
  const shown = text.length > 48 ? `${text.slice(0, 48)}…` : text;
  return {
    kind: "pipe",
    title: "Bytes in the pipe",
    bytes: new TextEncoder().encode(text).length,
    fields: [
      { name: "Text", value: `“${shown}”` },
      { name: "Encoding", value: "UTF-8" },
    ],
  };
}
