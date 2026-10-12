import { describe, expect, it } from "vitest";
import { stepped, travelled } from "./usePlayhead";

const nodeAt = [0, 0.25, 0.5, 1];

describe("the signal's progress along a route", () => {
  it("glides from stop to stop, waiting at each", () => {
    expect(travelled(nodeAt, 0)).toBe(0);
    expect(travelled(nodeAt, 1 / 3 - 0.01)).toBeCloseTo(0.25);
    expect(travelled(nodeAt, 1)).toBe(1);
  });

  it("with reduced motion, is at one stop and then the next, never between", () => {
    for (let t = 0; t <= 1; t += 0.01) expect(nodeAt).toContain(stepped(nodeAt, t));
    expect(stepped(nodeAt, 0)).toBe(0);
    expect(stepped(nodeAt, 0.2)).toBe(0);
    expect(stepped(nodeAt, 0.3)).toBe(0.25);
    expect(stepped(nodeAt, 1)).toBe(1);
  });
});
