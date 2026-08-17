import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MOTION, mergeMotion, type MotionPatch, type MotionSpec } from "@deks-js/document";
import { RendererCore, compileTransition, type ElementSnapshot, type SlideSnapshot } from "../src/index.js";

/** Motion arrives at the compiler already resolved, exactly as snapshots build it. */
const motion = (patch: MotionPatch = {}): MotionSpec => mergeMotion(DEFAULT_MOTION, patch);

const text = (id: string, x: number, content = "Same", patch: MotionPatch = {}): ElementSnapshot => ({
  id,
  kind: "text",
  name: id,
  rect: { x, y: 80, width: 600, height: 120 },
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

const rectangle = (
  id: string,
  cornerRadius: number,
  cornerRadii?: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number },
): ElementSnapshot => ({
  id,
  kind: "shape",
  shapeKind: "rectangle",
  name: id,
  rect: { x: 100, y: 100, width: 600, height: 320 },
  rotationDeg: 0,
  opacity: 1,
  zIndex: 1,
  motion: motion(),
  fillStyle: { kind: "solid", color: "#ff7043" },
  cornerRadius,
  ...(cornerRadii === undefined ? {} : { cornerRadii }),
});

const snapshot = (
  id: string,
  elements: ElementSnapshot[],
  patch: MotionPatch = { morph: { delayMs: 100 } },
): SlideSnapshot => ({
  id,
  canvas: { width: 1920, height: 1080 },
  background: { kind: "solid", color: id === "from" ? "#111111" : "#222222" },
  motionBeatMs: 800,
  motion: motion(patch),
  elements,
});

describe("element transition compiler contract", () => {
  it("morphs shared identity through canonical geometry without transform scaling", () => {
    const compiled = compileTransition(
      snapshot("from", [text("title", 100)]),
      snapshot("to", [{
        ...text("title", 300, "Same", { morph: { delayMs: 100 } }),
        name: "Renamed editorially",
        rect: { x: 300, y: 180, width: 900, height: 240 },
      }]),
    );

    expect(compiled.operations).toHaveLength(1);
    expect(compiled.operations[0]).toEqual(expect.objectContaining({
      elementId: "title",
      type: "change",
      effectiveBehavior: "morph",
      renderMode: "single",
      timing: { durationMs: 800, delayMs: 100, easing: "ease-in-out" },
    }));
    expect(compiled.operations[0]?.keyframes).toEqual([
      expect.objectContaining({ left: "5.208333333333334%", width: "31.25%" }),
      expect.objectContaining({ left: "15.625%", width: "46.875%" }),
    ]);
    expect(JSON.stringify(compiled.operations[0]?.keyframes)).not.toContain("scale(");
  });

  it("plays each role from the motion resolved on its own element", () => {
    const compiled = compileTransition(
      snapshot("from", [text("leaves", 100, "Same", { out: { animation: { kind: "none" } } })]),
      snapshot("to", [text("enters", 500, "Same", {
        in: { animation: { kind: "slide", edge: "top" }, durationBeats: 0.5, delayMs: 240 },
      })]),
    );

    // A `none` animation is a cut: no duration, whatever the beat says.
    expect(compiled.operations.find(({ elementId }) => elementId === "leaves")).toEqual(expect.objectContaining({
      type: "exit",
      effectiveBehavior: "cut",
      renderMode: "cut",
      timing: { durationMs: 0, delayMs: 0, easing: "ease-in" },
    }));
    const entering = compiled.operations.find(({ elementId }) => elementId === "enters")!;
    expect(entering).toEqual(expect.objectContaining({
      type: "enter",
      timing: { durationMs: 400, delayMs: 240, easing: "ease-out" },
    }));
    expect(entering.keyframes[0]).toEqual(expect.objectContaining({ top: "-11.11111111111111%", opacity: 0 }));
    expect(compiled.totalDurationMs).toBe(900);
  });

  it("travels an explicit distance instead of leaving the canvas", () => {
    const compiled = compileTransition(
      snapshot("from", []),
      snapshot("to", [text("enters", 500, "Same", {
        in: { animation: { kind: "slide", edge: "left", distance: 192 } },
      })]),
    );

    // 500 - 192 = 308 canvas units, not the full width of the element off-stage.
    expect(compiled.operations[0]?.keyframes[0]).toEqual(expect.objectContaining({
      left: `${(308 / 1920) * 100}%`,
      opacity: 0,
    }));
  });

  it("scales an element in without touching its canonical geometry", () => {
    const compiled = compileTransition(
      snapshot("from", []),
      snapshot("to", [text("enters", 500, "Same", { in: { animation: { kind: "scale", from: 0.8 } } })]),
    );

    const [first, last] = compiled.operations[0]!.keyframes as [Record<string, unknown>, Record<string, unknown>];
    expect(first.transform).toBe("rotate(0deg) scale(0.8)");
    expect(first.left).toBe(last.left);
    expect(last.transform).toBe("rotate(0deg)");
  });

  it("crossfades discrete content changes while retaining shared identity", () => {
    const compiled = compileTransition(
      snapshot("from", [text("title", 100, "Before")]),
      snapshot("to", [text("title", 100, "After")]),
    );

    expect(compiled.operations[0]).toEqual(expect.objectContaining({
      elementId: "title",
      type: "change",
      effectiveBehavior: "fade",
      renderMode: "crossfade",
      crossfadeKeyframes: expect.any(Object),
    }));
  });

  it("morphs per-corner rectangle radii while preserving the uniform fallback", () => {
    const compiled = compileTransition(
      snapshot("from", [rectangle("frame", 20)]),
      snapshot("to", [rectangle("frame", 20, {
        topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16,
      })]),
    );

    expect(compiled.operations[0]).toEqual(expect.objectContaining({
      elementId: "frame",
      effectiveBehavior: "morph",
      renderMode: "single",
    }));
    // Los keyframes deben hablar la misma unidad que el nodo montado; si no, el
    // primer frame saltaría entre una longitud del canvas y una del viewport.
    const relative = (value: number) => `${(value / 1920) * 100}cqw`;
    expect(compiled.operations[0]?.keyframes).toEqual([
      expect.objectContaining({ borderRadius: relative(20) }),
      expect.objectContaining({
        borderRadius: `${relative(4)} ${relative(8)} ${relative(12)} ${relative(16)}`,
      }),
    ]);
  });

  it("keeps every canvas length canvas-relative so embeds match fullscreen", () => {
    const compiled = compileTransition(
      snapshot("from", [rectangle("frame", 32)]),
      snapshot("to", [rectangle("frame", 48)]),
    );
    const [first, last] = compiled.operations[0]!.keyframes as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];

    // Ninguna longitud del canvas puede quedar anclada al viewport: si lo
    // estuviera, el mismo deck se vería más redondeado y con bordes más gruesos
    // en un embed pequeño que a pantalla completa.
    for (const frame of [first, last]) {
      for (const property of ["borderWidth", "borderRadius"]) {
        expect(String(frame[property])).toMatch(/cqw/);
        expect(String(frame[property])).not.toMatch(/px/);
      }
    }
    expect(first.borderRadius).toBe(`${(32 / 1920) * 100}cqw`);
    expect(last.borderRadius).toBe(`${(48 / 1920) * 100}cqw`);
  });

  it("resolves a none animation to a zero-duration cut", () => {
    const compiled = compileTransition(
      snapshot("from", []),
      snapshot("to", [text("title", 100, "Same", {
        in: { animation: { kind: "none" }, durationBeats: 2, delayMs: 100 },
      })]),
    );

    expect(compiled.operations[0]).toEqual(expect.objectContaining({
      type: "enter",
      effectiveBehavior: "cut",
      renderMode: "cut",
      timing: { durationMs: 0, delayMs: 100, easing: "ease-out" },
    }));
  });

  it("cuts a persisting element when its morph is a cut", () => {
    const compiled = compileTransition(
      snapshot("from", [text("title", 100)]),
      snapshot("to", [text("title", 300, "Same", { morph: { animation: { kind: "cut" } } })]),
    );

    expect(compiled.operations[0]).toEqual(expect.objectContaining({
      type: "change",
      effectiveBehavior: "cut",
      renderMode: "cut",
    }));
    expect(compiled.operations[0]?.timing.durationMs).toBe(0);
  });

  it("plays a boundary backwards by swapping the snapshots", () => {
    // Going back is not a special mode: the element that was leaving now arrives,
    // and each side keeps the motion its own slide declares.
    const first = snapshot("from", [text("title", 100)]);
    const second = snapshot("to", [text("title", 300, "Same", {
      out: { animation: { kind: "slide", edge: "left" }, durationBeats: 0.5, delayMs: 200 },
    })]);

    const backwards = compileTransition(second, first);
    expect(backwards.operations[0]).toEqual(expect.objectContaining({ type: "change" }));

    const leaving = compileTransition(second, snapshot("empty", []));
    expect(leaving.operations[0]).toEqual(expect.objectContaining({
      type: "exit",
      timing: { durationMs: 400, delayMs: 200, easing: "ease-in" },
    }));
  });
});

class PendingAnimation {
  currentTime: CSSNumberish | null = 0;
  playbackRate = 1;
  play = vi.fn();
  pause = vi.fn();
  cancel = vi.fn(() => this.reject(new DOMException("Animation canceled", "AbortError")));
  private resolve!: () => void;
  private reject!: (error: unknown) => void;
  finished = new Promise<void>((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });
}

describe("element transition playback contract", () => {
  it("removes persisted delay under reduced motion and commits the destination", async () => {
    const calls: KeyframeAnimationOptions[] = [];
    Element.prototype.animate = vi.fn((_keyframes, timing) => {
      calls.push(timing as KeyframeAnimationOptions);
      return {
        currentTime: 0,
        playbackRate: 1,
        pause: vi.fn(),
        play: vi.fn(),
        cancel: vi.fn(),
        finished: Promise.resolve(),
      } as unknown as Animation;
    });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const host = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(host);
    const from = snapshot("from", [text("title", 100, "Before")]);
    const to = snapshot("to", [text("title", 300, "After")]);

    const compiled = renderer.compileTransition(from, to);
    await renderer.play();

    expect(compiled.delayMs).toBe(100);
    expect(calls).toHaveLength(0);
    expect(host.querySelector('[data-element-id="title"]')?.textContent).toBe("After");
    expect(host.querySelectorAll('[data-element-id="title"]')).toHaveLength(1);
  });

  it("treats a canonical render as an interruption and leaves that destination authoritative", async () => {
    const animations: PendingAnimation[] = [];
    Element.prototype.animate = vi.fn(() => {
      const animation = new PendingAnimation();
      animations.push(animation);
      return animation as unknown as Animation;
    });
    const host = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(host);
    const from = snapshot("from", [text("title", 100, "Before")]);
    const to = snapshot("to", [text("title", 300, "Target")]);
    const remote = snapshot("remote", [text("title", 700, "Remote")]);

    renderer.compileTransition(from, to);
    const playback = renderer.play();
    renderer.renderSlide(remote);

    await expect(playback).resolves.toBeUndefined();
    expect(animations.every(({ cancel }) => cancel.mock.calls.length === 1)).toBe(true);
    expect(host.querySelector('[data-element-id="title"]')?.textContent).toBe("Remote");
    expect(host.querySelectorAll('[data-element-id="title"]')).toHaveLength(1);
  });
});
