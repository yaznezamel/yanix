import { describe, expect, it } from "vitest";
import { MACHINE } from "./hierarchy";
import { hasGlyph, strokeText, strokeWidthOf } from "./strokeFont";

describe("stroke font", () => {
  it("has a glyph for every character the drawings write", () => {
    const silk = (MACHINE.decor ?? []).flatMap((d) => (d.text ?? "").split("\n"));
    const written = ["YANIX", "TEACHING CPU", "4 CORES · ILLUSTRATIVE", "CR2032", ...silk];
    for (const line of written) for (const char of line) expect(hasGlyph(char), `${char} in ${line}`).toBe(true);
  });

  it("places and scales a glyph", () => {
    expect(strokeText("I", 0, 0, 6)).toBe("M1 0H3M2 0V6M1 6H3");
    // Twice the size, moved right by 10 and down by 5.
    expect(strokeText("I", 10, 5, 12)).toBe("M12 5H16M14 5V17M12 17H16");
    expect(strokeText("A", 0, 0, 6)).toBe("M0 6L2 0L4 6M0.7 4H3.3");
  });

  it("centres a line on x when asked, and spaces letters evenly", () => {
    const width = strokeWidthOf("II", 6);
    // Two glyphs 4 wide with a quarter of the height between them.
    expect(width).toBeCloseTo(4 + 1.5 + 4);
    const centred = strokeText("II", 100, 0, 6, { anchor: "middle" });
    expect(centred.startsWith(`M${100 - width / 2 + 1} 0`)).toBe(true);
    expect(strokeText("", 0, 0, 6)).toBe("");
    expect(strokeWidthOf("", 6)).toBe(0);
  });
});
