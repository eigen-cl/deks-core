import { describe, expect, it } from "vitest";
import { reanchorElementState, type DeksElementState } from "../src";

const state = (patch: Partial<DeksElementState> = {}): DeksElementState => ({
  elementId: "shape",
  x: 100,
  y: 200,
  width: 300,
  height: 100,
  rotationDeg: 90,
  opacity: 1,
  zIndex: 1,
  shapeFill: { kind: "solid", color: "#ff7043" },
  stroke: "#ffffff",
  strokeWidth: 2,
  ...patch,
});

describe("portable element anchor geometry", () => {
  it("changes anchor around a rotated box without moving its visual geometry", () => {
    const centered = reanchorElementState(state(), { x: 0.5, y: 0.5 });

    // R(90deg) * (150, 50) = (-50, 150).
    expect(centered.x).toBeCloseTo(50);
    expect(centered.y).toBeCloseTo(350);
    expect(centered.anchor).toEqual({ x: 0.5, y: 0.5 });
    expect(state()).not.toHaveProperty("anchor");
  });

  it("treats omission as top-left and can remove an explicit anchor without a jump", () => {
    const centered = state({ x: 50, y: 350, anchor: { x: 0.5, y: 0.5 } });
    const legacy = reanchorElementState(centered);
    expect(legacy.x).toBeCloseTo(100);
    expect(legacy.y).toBeCloseTo(200);
    expect(legacy).not.toHaveProperty("anchor");

    expect(reanchorElementState(state(), { x: 0, y: 0 })).toEqual({
      ...state(),
      anchor: { x: 0, y: 0 },
    });
  });
});
