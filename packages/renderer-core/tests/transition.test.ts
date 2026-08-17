import { describe, expect, it } from "vitest";
import { compileTransition } from "../src/index.js";
import type { Easing, SlideSnapshot, TransitionOptions } from "../src/index.js";

const text = (id: string, x: number) => ({
  id,
  kind: "text" as const,
  rect: { x, y: 20, width: 200, height: 80 },
  rotationDeg: 0,
  opacity: 1,
  zIndex: 1,
  content: id,
  fontFamily: "Poppins",
  fontSize: 32,
  fontWeight: 400,
  lineHeight: 1.2,
  letterSpacing: 0,
  horizontalAlignment: "left" as const,
  verticalAlignment: "top" as const,
  color: "#ffffff"
});

const slide = (id: string, elements: SlideSnapshot["elements"]): SlideSnapshot => ({
  id,
  canvas: { width: 1920, height: 1080 },
  elements
});

const timing = (
  motionBeatMs: number,
  delayMs = 0,
  easing: Easing = "linear"
): TransitionOptions => ({ motionBeatMs, durationMultiplier: 1, delayMs, easing });

describe("compileTransition", () => {
  it("derives enter, change, and exit from stable element identity", () => {
    const result = compileTransition(
      slide("a", [text("leaves", 10), text("moves", 20)]),
      slide("b", [text("moves", 300), text("enters", 500)]),
      timing(600, 100, "ease-in-out")
    );

    expect(result.operations.map(({ elementId, type }) => [elementId, type])).toEqual([
      ["leaves", "exit"],
      ["moves", "change"],
      ["enters", "enter"]
    ]);
    expect(result.totalDurationMs).toBe(700);
    expect(result.operations[1]?.keyframes).toEqual([
      expect.objectContaining({ left: "20px", top: "20px", transform: "rotate(0deg)", opacity: 1 }),
      expect.objectContaining({ left: "300px", top: "20px", transform: "rotate(0deg)", opacity: 1 })
    ]);
  });

  it("scales shape geometry between absolute rectangles", () => {
    const from = {
      id: "box", kind: "shape" as const, shapeKind: "rectangle" as const,
      rect: { x: 10, y: 20, width: 200, height: 80 }, rotationDeg: 0,
      opacity: 1, zIndex: 1, fillStyle: { kind: "solid" as const, color: "#fff" }
    };
    const to = { ...from, rect: { x: 40, y: 50, width: 400, height: 40 }, rotationDeg: 45 };
    const operation = compileTransition(slide("a", [from]), slide("b", [to]), timing(500)).operations[0];

    expect(operation?.keyframes[1]).toEqual(expect.objectContaining({
      left: "40px", top: "50px", width: "400px", height: "40px", transform: "rotate(45deg)"
    }));
  });

  it("interpolates each canonical rectangle corner radius", () => {
    const from = {
      id: "box", kind: "shape" as const, shapeKind: "rectangle" as const,
      rect: { x: 10, y: 20, width: 200, height: 80 }, rotationDeg: 0,
      opacity: 1, zIndex: 1, fillStyle: { kind: "solid" as const, color: "#fff" },
      cornerRadii: { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 },
    };
    const to = {
      ...from,
      cornerRadii: { topLeft: 20, topRight: 24, bottomRight: 28, bottomLeft: 32 },
    };
    const operation = compileTransition(slide("a", [from]), slide("b", [to]), timing(500)).operations[0]!;

    expect(operation.keyframes).toEqual([
      expect.objectContaining({ borderRadius: "4px 8px 12px 16px" }),
      expect.objectContaining({ borderRadius: "20px 24px 28px 32px" }),
    ]);
  });

  it("carries solid and gradient shape fills in transition keyframes", () => {
    const from = {
      id: "box", kind: "shape" as const, shapeKind: "rectangle" as const,
      rect: { x: 10, y: 20, width: 200, height: 80 }, rotationDeg: 0,
      opacity: 1, zIndex: 1, fillStyle: { kind: "solid" as const, color: "#FF7043" }
    };
    const to = { ...from, fillStyle: { kind: "linear-gradient" as const, angleDeg: 90, startColor: "#FF7043", endColor: "#73A7FF" } };
    const operation = compileTransition(slide("a", [from]), slide("b", [to]), timing(500)).operations[0]!;

    expect(operation.renderMode).toBe("crossfade");
    expect(operation.keyframes).toEqual([
      expect.objectContaining({ backgroundColor: "#FF7043", backgroundImage: "none" }),
      expect.objectContaining({ backgroundColor: "transparent", backgroundImage: "linear-gradient(90deg, #FF7043, #73A7FF)" }),
    ]);
  });

  it("interpolates text rect and font metrics without transform scale", () => {
    const from = text("title", 10);
    const to = {
      ...text("title", 400),
      rect: { x: 400, y: 50, width: 420, height: 160 },
      rotationDeg: 30,
      opacity: 0.7
    };
    const operation = compileTransition(slide("a", [from]), slide("b", [to]), timing(500)).operations[0]!;

    expect(operation).toEqual(expect.objectContaining({ effectiveBehavior: "morph", renderMode: "single" }));
    expect(operation.keyframes[0]).toEqual(expect.objectContaining({ left: "10px", width: "200px", fontSize: "32px" }));
    expect(operation.keyframes[1]).toEqual(expect.objectContaining({ left: "400px", width: "420px", fontSize: "32px" }));
    expect(JSON.stringify(operation.keyframes)).not.toContain("scale(");
  });

  it("animates only text position, rotation, and opacity when its rect size is unchanged", () => {
    const from = text("title", 10);
    const to = { ...text("title", 400), rotationDeg: 30, opacity: 0.7 };
    const operation = compileTransition(slide("a", [from]), slide("b", [to]), timing(500)).operations[0]!;

    expect(operation.renderMode).toBe("single");
    expect(operation.keyframes).toEqual([
      expect.objectContaining({ left: "10px", top: "20px", transform: "rotate(0deg)", opacity: 1 }),
      expect.objectContaining({ left: "400px", top: "20px", transform: "rotate(30deg)", opacity: 0.7 })
    ]);
  });

  it("crossfades font-family but interpolates numeric font size", () => {
    const from = text("title", 10);
    const sizeOperation = compileTransition(slide("a", [from]), slide("b", [{ ...text("title", 400), fontSize: 80 }]), timing(500)).operations[0]!;
    const familyOperation = compileTransition(slide("a", [from]), slide("b", [{ ...text("title", 400), fontFamily: "Roboto" }]), timing(500)).operations[0]!;

    expect(sizeOperation).toEqual(expect.objectContaining({ effectiveBehavior: "morph", renderMode: "single" }));
    expect(sizeOperation.keyframes[1]).toEqual(expect.objectContaining({ fontSize: "80px" }));
    expect(familyOperation).toEqual(expect.objectContaining({ effectiveBehavior: "fade", renderMode: "crossfade" }));
  });

  it("rejects invalid canvas, timing, geometry, and easing", () => {
    expect(() => compileTransition(slide("a", []), slide("b", []), {
      motionBeatMs: -1,
      durationMultiplier: 1,
      delayMs: 0,
      easing: "linear"
    })).toThrow("motionBeatMs");
    expect(() => compileTransition(slide("a", []), slide("b", []), {
      motionBeatMs: 1,
      durationMultiplier: 1,
      delayMs: 0,
      easing: "steps(2)" as "linear"
    })).toThrow("easing");
    expect(() => compileTransition(slide("a", [
      { ...text("bad", 0), rect: { x: Number.NaN, y: 0, width: 1, height: 1 } }
    ]), slide("b", []), {
      motionBeatMs: 1,
      durationMultiplier: 1,
      delayMs: 0,
      easing: "linear"
    })).toThrow("finite");
    expect(() => compileTransition(
      { ...slide("a", []), backgroundColor: "#000000" } as never,
      slide("b", []),
      timing(1)
    )).toThrow("backgroundColor is not supported; use background");
  });

  it("crossfades discrete text/font/image changes and morphs geometry by default", () => {
    const image = (id: string, src: string) => ({
      id, kind: "image" as const, rect: { x: 10, y: 10, width: 100, height: 100 },
      rotationDeg: 0, opacity: 1, zIndex: 2, src, alt: id, fit: "cover" as const
    });
    const fromText = text("title", 20);
    const toText = { ...text("title", 400), content: "Nuevo", fontFamily: "Roboto" };
    const result = compileTransition(
      slide("a", [fromText, image("hero", "/old.png"), text("moves", 5)]),
      slide("b", [toText, image("hero", "/new.png"), text("moves", 700)]),
      timing(600, 0, "ease-in-out")
    );

    expect(result.operations.find((item) => item.elementId === "title")).toEqual(expect.objectContaining({
      effectiveBehavior: "fade", renderMode: "crossfade"
    }));
    expect(result.operations.find((item) => item.elementId === "hero")).toEqual(expect.objectContaining({
      effectiveBehavior: "fade", renderMode: "crossfade"
    }));
    expect(result.operations.find((item) => item.elementId === "moves")).toEqual(expect.objectContaining({
      effectiveBehavior: "morph", renderMode: "single"
    }));
  });

  it("cuts an element without changing the edge clock when animation is disabled", () => {
    const from = text("title", 20);
    const to = { ...text("title", 500), content: "Corte" };
    const result = compileTransition(slide("a", [from]), slide("b", [to]), {
      motionBeatMs: 600,
      durationMultiplier: 1,
      delayMs: 100,
      easing: "ease-in-out",
      overrides: {
        title: {
          animate: false,
          delayMs: 250
        }
      }
    });

    expect(result.operations[0]).toEqual(expect.objectContaining({
      effectiveBehavior: "cut",
      renderMode: "cut",
      timing: {
        durationMs: 0,
        delayMs: 250,
        easing: "ease-in-out"
      }
    }));
    expect(result.totalDurationMs).toBe(700);
  });

  it("rejects invalid override references and timing", () => {
    expect(() => compileTransition(slide("a", [text("title", 0)]), slide("b", []), {
      motionBeatMs: 100,
      durationMultiplier: 1,
      delayMs: 0,
      easing: "linear",
      overrides: { missing: { animate: true } }
    })).toThrow("unknown element");
    expect(() => compileTransition(slide("a", [text("title", 0)]), slide("b", []), {
      motionBeatMs: 100,
      durationMultiplier: 1,
      delayMs: 0,
      easing: "linear",
      overrides: { title: { animate: true, durationMultiplier: -1 } }
    })).toThrow("durationMultiplier");
  });

  it("applies directional fade, none, and glide presets only to entering and exiting elements", () => {
    const result = compileTransition(
      slide("a", [text("leaves", 20), text("stays", 30)]),
      slide("b", [text("stays", 300), text("enters", 500)]),
      {
        motionBeatMs: 800,
        durationMultiplier: 1.5,
        delayMs: 0,
        easing: "ease-in-out",
        inPreset: { preset: "glide-right", durationMultiplier: 0.5 },
        outPreset: { preset: "none", durationMultiplier: 0.5 }
      }
    );

    const exit = result.operations.find((operation) => operation.elementId === "leaves")!;
    const change = result.operations.find((operation) => operation.elementId === "stays")!;
    const enter = result.operations.find((operation) => operation.elementId === "enters")!;

    expect(exit).toEqual(expect.objectContaining({
      type: "exit",
      effectiveBehavior: "cut",
      renderMode: "cut",
      timing: expect.objectContaining({ durationMs: 0 })
    }));
    expect(change.timing.durationMs).toBe(1200);
    expect(enter).toEqual(expect.objectContaining({
      type: "enter",
      effectiveBehavior: "fade",
      timing: expect.objectContaining({ durationMs: 400 })
    }));
    expect(enter.keyframes).toEqual([
      expect.objectContaining({ left: "1920px", top: "20px", transform: "rotate(0deg)", opacity: 0 }),
      expect.objectContaining({ left: "500px", top: "20px", transform: "rotate(0deg)", opacity: 1 })
    ]);
  });

  it("moves glide exits beyond the requested canvas edge while fading", () => {
    const result = compileTransition(
      slide("a", [text("title", 120)]),
      slide("b", []),
      {
        motionBeatMs: 600,
        durationMultiplier: 1,
        delayMs: 0,
        easing: "linear",
        outPreset: { preset: "glide-top", durationMultiplier: 0.75 }
      }
    );

    expect(result.operations[0]?.keyframes).toEqual([
      expect.objectContaining({ left: "120px", top: "20px", transform: "rotate(0deg)", opacity: 1 }),
      expect.objectContaining({ left: "120px", top: "-80px", transform: "rotate(0deg)", opacity: 0 })
    ]);
  });

  it("choreographs independent entry and exit motion for one persistent element", () => {
    const result = compileTransition(
      slide("a", [text("metric", 120)]),
      slide("b", [text("metric", 720)]),
      {
        motionBeatMs: 800,
        durationMultiplier: 1,
        delayMs: 0,
        easing: "ease-in-out",
        elementMotions: {
          metric: {
            in: { preset: "glide-left", durationMultiplier: 0.75, delayMs: 120 },
            out: { preset: "glide-right", durationMultiplier: 0.5, delayMs: 40 },
          },
        },
      },
    );

    const operation = result.operations[0]!;
    expect(operation).toEqual(expect.objectContaining({
      type: "change",
      effectiveBehavior: "fade",
      renderMode: "crossfade",
      crossfadeTiming: {
        from: { durationMs: 400, delayMs: 40, easing: "ease-in" },
        to: { durationMs: 600, delayMs: 120, easing: "ease-out" },
      },
    }));
    expect(operation.crossfadeKeyframes?.from).toEqual([
      expect.objectContaining({ left: "120px", opacity: 1 }),
      expect.objectContaining({ left: "1920px", opacity: 0 }),
    ]);
    expect(operation.crossfadeKeyframes?.to).toEqual([
      expect.objectContaining({ left: "-200px", opacity: 0 }),
      expect.objectContaining({ left: "720px", opacity: 1 }),
    ]);
    // The edge clock remains the floor so playback/scrubbing stays stable even
    // when both element motions finish slightly earlier.
    expect(result.totalDurationMs).toBe(800);
  });

  it("uses element motion for presence and validates its compact contract", () => {
    const result = compileTransition(
      slide("a", []),
      slide("b", [text("enters", 500)]),
      {
        motionBeatMs: 600,
        durationMultiplier: 1,
        delayMs: 0,
        easing: "linear",
        elementMotions: {
          enters: {
            in: { preset: "fade", durationMultiplier: 1.5, delayMs: 80 },
          },
        },
      },
    );
    expect(result.operations[0]).toEqual(expect.objectContaining({
      timing: { durationMs: 900, delayMs: 80, easing: "ease-out" },
    }));

    expect(() => compileTransition(slide("a", []), slide("b", [text("enters", 500)]), {
      motionBeatMs: 600,
      durationMultiplier: 1,
      delayMs: 0,
      easing: "linear",
      elementMotions: {
        enters: { in: { preset: "spin" as "fade", durationMultiplier: 1, delayMs: 0 } },
      },
    })).toThrow("invalid element motion preset");
  });

  it("resolves element duration as a ratio of the global motion beat", () => {
    const result = compileTransition(
      slide("a", [text("title", 20)]),
      slide("b", [text("title", 500)]),
      {
        motionBeatMs: 800,
        durationMultiplier: 1.5,
        delayMs: 0,
        easing: "ease-in-out",
        overrides: {
          title: { animate: true, durationMultiplier: 0.5, delayMs: 120 }
        }
      }
    );

    expect(result.operations[0]?.timing).toEqual({
      durationMs: 400,
      delayMs: 120,
      easing: "ease-in-out"
    });
    expect(result.totalDurationMs).toBe(1200);
  });

  it("rejects the removed absolute-duration override instead of mixing it with the beat contract", () => {
    const from = slide("a", [text("title", 20)]);
    const to = slide("b", [text("title", 500)]);

    expect(() => compileTransition(from, to, {
      motionBeatMs: 800,
      durationMultiplier: 1,
      delayMs: 0,
      easing: "linear",
      overrides: {
        title: {
          animate: true,
          durationMultiplier: 0.5,
          // Regression: API null used to cross the adapter boundary as the removed
          // absolute-duration field and fail later with a misleading finite-number error.
          durationMs: null
        } as never
      }
    })).toThrow("title.durationMs is not supported; use durationMultiplier");
  });

  it("lets animate false dominate duration ratio while preserving delay", () => {
    const result = compileTransition(
      slide("a", [text("title", 20)]),
      slide("b", [{ ...text("title", 500), content: "Corte" }]),
      {
        motionBeatMs: 800,
        durationMultiplier: 1,
        delayMs: 0,
        easing: "linear",
        overrides: {
          title: {
            animate: false,
            durationMultiplier: 0.5,
            delayMs: 160
          }
        }
      }
    );

    expect(result.operations[0]).toEqual(expect.objectContaining({
      effectiveBehavior: "cut",
      renderMode: "cut",
      timing: { durationMs: 0, delayMs: 160, easing: "linear" }
    }));
  });

  it("rejects a negative or non-finite duration ratio", () => {
    const from = slide("a", [text("title", 20)]);
    const to = slide("b", [text("title", 500)]);
    expect(() => compileTransition(from, to, {
      motionBeatMs: 800, durationMultiplier: 1, delayMs: 0, easing: "linear",
      overrides: { title: { animate: true, durationMultiplier: -0.1 } }
    })).toThrow("durationMultiplier");
    expect(() => compileTransition(from, to, {
      motionBeatMs: 800, durationMultiplier: 1, delayMs: 0, easing: "linear",
      overrides: { title: { animate: true, durationMultiplier: Number.NaN } }
    })).toThrow("durationMultiplier");
    expect(() => compileTransition(slide("a", [text("title", 10)]), slide("b", [text("title", 20)]), {
      motionBeatMs: 800, durationMultiplier: 1.25, delayMs: 0, easing: "linear"
    })).toThrow("must be one of");
  });
});
