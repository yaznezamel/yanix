// A tiny stroke font for the writing on the hardware: the silkscreen on the
// board, the engraving on the CPU's lid, the battery's type. Board design
// tools print silkscreen with stroke fonts like this one. Here it also keeps
// zooming fast: SVG text is laid out again whenever the zoom changes, and a
// path is not. Only the characters the drawings use are defined.
//
// Glyphs are drawn on a grid 4 wide and 6 tall, from the top of a capital
// letter, with absolute commands only (M, L, H, V, Q, Z).

const GLYPHS: Record<string, string> = {
  A: "M0 6L2 0L4 6M0.7 4H3.3",
  B: "M0 6V0H2.8Q4 0 4 1.5Q4 3 2.8 3H0M2.8 3Q4 3 4 4.5Q4 6 2.8 6H0",
  C: "M4 1Q3.4 0 2 0Q0 0 0 3Q0 6 2 6Q3.4 6 4 5",
  E: "M4 0H0V6H4M0 3H3",
  G: "M4 1Q3.4 0 2 0Q0 0 0 3Q0 6 2 6Q4 6 4 4V3.4H2.2",
  H: "M0 0V6M4 0V6M0 3H4",
  I: "M1 0H3M2 0V6M1 6H3",
  L: "M0 0V6H4",
  N: "M0 6V0L4 6V0",
  O: "M2 0Q0 0 0 3Q0 6 2 6Q4 6 4 3Q4 0 2 0Z",
  P: "M0 6V0H2.8Q4 0 4 1.5Q4 3 2.8 3H0",
  R: "M0 6V0H2.8Q4 0 4 1.5Q4 3 2.8 3H0M2.4 3L4 6",
  S: "M4 1Q3.5 0 2 0Q0 0 0 1.5Q0 3 2 3Q4 3 4 4.5Q4 6 2 6Q0.5 6 0 5",
  T: "M0 0H4M2 0V6",
  U: "M0 0V4Q0 6 2 6Q4 6 4 4V0",
  V: "M0 0L2 6L4 0",
  X: "M0 0L4 6M4 0L0 6",
  Y: "M0 0L2 3L4 0M2 3V6",
  "0": "M2 0Q0.4 0 0.4 3Q0.4 6 2 6Q3.6 6 3.6 3Q3.6 0 2 0Z",
  "1": "M1 1L2 0V6M1 6H3",
  "2": "M0 1Q0.5 0 2 0Q4 0 4 1.7Q4 3 0 6H4",
  "3": "M0 0.8Q0.6 0 2 0Q4 0 4 1.5Q4 3 2 3Q4 3 4 4.5Q4 6 2 6Q0.6 6 0 5.2",
  "4": "M3 6V0L0 4.2H4",
  "-": "M0.8 3H3.2",
  ".": "M1.9 5.8H2.1",
  "·": "M1.9 3H2.1",
  " ": "",
};

const WIDTH = 4;
const HEIGHT = 6;

export function hasGlyph(char: string): boolean {
  return char in GLYPHS;
}

/** The width of a line of text, `size` tall (the height of a capital), with `gap` of the size between letters. */
export function strokeWidthOf(text: string, size: number, gap = 0.25): number {
  const scale = size / HEIGHT;
  return text.length === 0 ? 0 : (text.length * WIDTH + (text.length - 1) * gap * HEIGHT) * scale;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** A glyph's path moved to (x, y) and scaled. */
function place(glyph: string, x: number, y: number, scale: number): string {
  const tokens = glyph.match(/[MLHVQZ]|-?\d*\.?\d+/g) ?? [];
  let out = "";
  let command = "";
  let axis = 0;
  for (const token of tokens) {
    if (/[MLHVQZ]/.test(token)) {
      command = token;
      axis = 0;
      out += token;
      continue;
    }
    const v = Number(token);
    // H takes x values, V takes y values; the others take x, y pairs.
    const isX = command === "H" || (command !== "V" && axis % 2 === 0);
    out += `${axis > 0 ? " " : ""}${round(isX ? x + v * scale : y + v * scale)}`;
    axis++;
  }
  return out;
}

/**
 * A line of text as path data for a stroke: its top left corner at (x, y),
 * or its top centre with `anchor: "middle"`. Unknown characters are skipped.
 */
export function strokeText(
  text: string,
  x: number,
  y: number,
  size: number,
  { anchor = "start", gap = 0.25 }: { anchor?: "start" | "middle"; gap?: number } = {},
): string {
  const scale = size / HEIGHT;
  const advance = (WIDTH + gap * HEIGHT) * scale;
  const left = anchor === "middle" ? x - strokeWidthOf(text, size, gap) / 2 : x;
  return [...text]
    .map((char, i) => {
      const glyph = GLYPHS[char];
      return glyph ? place(glyph, left + i * advance, y, scale) : "";
    })
    .join("");
}
