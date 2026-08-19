import { describe, expect, it } from "vitest";
import { DEFAULT_MOTION, mergeMotion, type MotionPatch, type MotionSpec } from "@deks-js/document";
import { RendererCore, compileTransition, type ElementSnapshot, type SlideSnapshot } from "../src/index.js";

const motion = (patch: MotionPatch = {}): MotionSpec => mergeMotion(DEFAULT_MOTION, patch);

const figure = (
  value: number,
  animateMagnitude: { in: boolean; morph: boolean; out: boolean } = { in: false, morph: false, out: false },
  patch: MotionPatch = {},
): ElementSnapshot => ({
  id: "growth",
  kind: "number",
  name: "Growth",
  rect: { x: 100, y: 100, width: 600, height: 300 },
  rotationDeg: 0,
  opacity: 1,
  zIndex: 1,
  motion: motion(patch),
  value,
  decimals: 1,
  groupSeparator: ",",
  decimalSeparator: ".",
  symbol: "%",
  symbolPosition: "after",
  animateMagnitude,
  fontFamily: "Poppins",
  fontSize: 148,
  fontWeight: 600,
  lineHeight: 1,
  letterSpacing: -6,
  horizontalAlignment: "center",
  verticalAlignment: "middle",
  color: "#65c18c",
  overflowMode: "hidden",
});

const text = (id: string, content: string, patch: MotionPatch = {}): ElementSnapshot => ({
  id,
  kind: "text",
  name: id,
  rect: { x: 100, y: 500, width: 800, height: 120 },
  rotationDeg: 0,
  opacity: 1,
  zIndex: 1,
  motion: motion(patch),
  content,
  fontFamily: "Poppins",
  fontSize: 64,
  fontWeight: 700,
  lineHeight: 1.1,
  letterSpacing: 0,
  horizontalAlignment: "left",
  verticalAlignment: "top",
  color: "#ffffff",
  overflowMode: "hidden",
});

const snapshot = (id: string, elements: ElementSnapshot[]): SlideSnapshot => ({
  id,
  canvas: { width: 1920, height: 1080 },
  background: { kind: "solid", color: "#111111" },
  motionBeatMs: 800,
  motion: motion(),
  elements,
});

describe("crop", () => {
  it("travels the element's own box and never touches opacity", () => {
    const compiled = compileTransition(
      snapshot("from", []),
      snapshot("to", [figure(38.5, undefined, { in: { animation: { kind: "crop", edge: "bottom" } } })]),
    );

    const operation = compiled.operations[0]!;
    expect(operation.crop).toEqual({
      edge: "bottom",
      keyframes: [{ transform: "translate(0, 100%)" }, { transform: "translate(0, 0)" }],
    });
    // The rectangle itself stays put and stays opaque: that is the whole point.
    expect(operation.keyframes[0]).not.toHaveProperty("opacity", 0);
    expect(operation.keyframes[0]!.left).toBe(operation.keyframes[1]!.left);
    expect(operation.keyframes[0]!.top).toBe(operation.keyframes[1]!.top);
  });

  it("reverses for the role it leaves in", () => {
    const compiled = compileTransition(
      snapshot("from", [figure(38.5, undefined, { out: { animation: { kind: "crop", edge: "left" } } })]),
      snapshot("to", []),
    );

    expect(compiled.operations[0]!.crop!.keyframes).toEqual([
      { transform: "translate(0, 0)" },
      { transform: "translate(-100%, 0)" },
    ]);
  });

  it("maps every edge to the axis it is named after", () => {
    const edges = { left: "translate(-100%, 0)", right: "translate(100%, 0)", top: "translate(0, -100%)", bottom: "translate(0, 100%)" };
    for (const [edge, transform] of Object.entries(edges)) {
      const compiled = compileTransition(
        snapshot("from", []),
        snapshot("to", [figure(1, undefined, { in: { animation: { kind: "crop", edge: edge as "left" } } })]),
      );
      expect(compiled.operations[0]!.crop!.keyframes[0], edge).toEqual({ transform });
    }
  });

  it("leaves every other animation without a crop", () => {
    for (const animation of [{ kind: "fade" }, { kind: "slide", edge: "left" }, { kind: "scale", from: 0.9 }] as const) {
      const compiled = compileTransition(
        snapshot("from", []),
        snapshot("to", [text("title", "Hello", { in: { animation } })]),
      );
      expect(compiled.operations[0]!.crop).toBeUndefined();
      expect(compiled.operations[0]!.keyframes[0]!.opacity).toBe(0);
    }
  });
});

describe("magnitude", () => {
  it("counts up from zero when it enters and down to zero when it leaves", () => {
    const entering = compileTransition(
      snapshot("from", []),
      snapshot("to", [figure(38.5, { in: true, morph: false, out: false })]),
    );
    expect(entering.operations[0]!.magnitude).toEqual({ from: 0, to: 38.5 });

    const leaving = compileTransition(
      snapshot("from", [figure(38.5, { in: false, morph: false, out: true })]),
      snapshot("to", []),
    );
    expect(leaving.operations[0]!.magnitude).toEqual({ from: 38.5, to: 0 });
  });

  it("counts between the two slides on a morph", () => {
    const compiled = compileTransition(
      snapshot("from", [figure(12.5, { in: false, morph: true, out: false })]),
      snapshot("to", [figure(38.5, { in: false, morph: true, out: false })]),
    );

    expect(compiled.operations[0]!.magnitude).toEqual({ from: 12.5, to: 38.5 });
    // A counting figure interpolates; crossfading it would show two magnitudes
    // through each other, which is exactly what it must not do.
    expect(compiled.operations[0]!.effectiveBehavior).toBe("morph");
    expect(compiled.operations[0]!.renderMode).toBe("single");
  });

  it("stays silent when the role that is playing is switched off", () => {
    const compiled = compileTransition(
      snapshot("from", []),
      snapshot("to", [figure(38.5, { in: false, morph: true, out: true })]),
    );
    expect(compiled.operations[0]!.magnitude).toBeUndefined();
  });

  it("crossfades two magnitudes that do not count, rather than sliding digits", () => {
    const compiled = compileTransition(
      snapshot("from", [figure(12.5)]),
      snapshot("to", [figure(38.5)]),
    );
    expect(compiled.operations[0]!.magnitude).toBeUndefined();
    expect(compiled.operations[0]!.renderMode).toBe("crossfade");
  });

  it("shows the final value immediately on a cut", () => {
    const compiled = compileTransition(
      snapshot("from", [figure(12.5, { in: false, morph: true, out: false })]),
      snapshot("to", [figure(38.5, { in: false, morph: true, out: false }, { morph: { animation: { kind: "cut" } } })]),
    );
    expect(compiled.operations[0]!.magnitude).toBeUndefined();
    expect(compiled.operations[0]!.timing.durationMs).toBe(0);
  });

  it("does not count a magnitude that did not change", () => {
    const compiled = compileTransition(
      snapshot("from", [figure(38.5, { in: false, morph: true, out: false })]),
      snapshot("to", [figure(38.5, { in: false, morph: true, out: false })]),
    );
    expect(compiled.operations[0]!.magnitude).toBeUndefined();
  });
});

describe("rendering a number", () => {
  it("paints the declared formatting with tabular figures", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const renderer = new RendererCore();
    renderer.mount(host);
    renderer.renderSlide(snapshot("only", [figure(1234.56)]));

    const node = host.querySelector<HTMLElement>('[data-element-kind="number"]')!;
    expect(node.textContent).toBe("1,234.6%");
    // Without tabular figures the box rewrites its own width on every counted
    // frame, and the figure wobbles instead of rising.
    expect(node.style.fontVariantNumeric).toBe("tabular-nums");
    renderer.destroy();
    host.remove();
  });
});
