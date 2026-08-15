import { describe, expect, it, vi } from "vitest";
import type { SlideTransition } from "@deks-js/document";
import { RendererCore, compileTransition, type ElementSnapshot, type SlideSnapshot } from "../src/index.js";

const text = (id: string, x: number, content = "Same"): ElementSnapshot => ({
  id,
  kind: "text",
  name: id,
  rect: { x, y: 80, width: 600, height: 120 },
  rotationDeg: 0,
  opacity: 1,
  zIndex: 1,
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
  fillStyle: { kind: "solid", color: "#ff7043" },
  cornerRadius,
  ...(cornerRadii === undefined ? {} : { cornerRadii }),
});

const snapshot = (
  id: string,
  elements: ElementSnapshot[],
  presets: Partial<Pick<SlideSnapshot, "inPreset" | "outPreset" | "inDurationMultiplier" | "outDurationMultiplier">> = {},
): SlideSnapshot => ({
  id,
  canvas: { width: 1920, height: 1080 },
  background: { kind: "solid", color: id === "from" ? "#111111" : "#222222" },
  elements,
  ...presets,
});

const edge = (patch: Partial<SlideTransition> = {}): SlideTransition => ({
  fromSlideId: "from",
  toSlideId: "to",
  motionBeatMs: 800,
  durationMultiplier: 1,
  effectiveDurationMs: 800,
  delayMs: 100,
  easing: "ease-in-out",
  ...patch,
});

describe("element transition compiler contract", () => {
  it("morphs shared identity through canonical geometry without transform scaling", () => {
    const compiled = compileTransition(
      snapshot("from", [text("title", 100)]),
      snapshot("to", [{ ...text("title", 300), name: "Renamed editorially", rect: { x: 300, y: 180, width: 900, height: 240 } }]),
      edge(),
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

  it("resolves presence preset, duration ratio, delay, element motions, and overrides", () => {
    const compiled = compileTransition(
      snapshot("from", [text("leaves", 100)], { outPreset: "glide-left", outDurationMultiplier: 0.75 }),
      snapshot("to", [text("enters", 500)], { inPreset: "glide-right", inDurationMultiplier: 1.5 }),
      edge({
        overrides: [{ elementId: "leaves", animate: false }],
        elementMotions: [{ elementId: "enters", direction: "in", preset: "glide-top", durationMultiplier: 0.5, delayMs: 240 }],
      }),
    );

    expect(compiled.operations.find(({ elementId }) => elementId === "leaves")).toEqual(expect.objectContaining({
      type: "exit",
      effectiveBehavior: "cut",
      timing: { durationMs: 0, delayMs: 100, easing: "ease-in-out" },
    }));
    const entering = compiled.operations.find(({ elementId }) => elementId === "enters")!;
    expect(entering).toEqual(expect.objectContaining({
      type: "enter",
      timing: { durationMs: 400, delayMs: 240, easing: "ease-out" },
    }));
    expect(entering.keyframes[0]).toEqual(expect.objectContaining({ top: "-11.11111111111111%", opacity: 0 }));
    expect(compiled.totalDurationMs).toBe(900);
  });

  it("crossfades discrete content changes while retaining shared identity", () => {
    const compiled = compileTransition(
      snapshot("from", [text("title", 100, "Before")]),
      snapshot("to", [text("title", 100, "After")]),
      edge(),
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
      edge(),
    );

    expect(compiled.operations[0]).toEqual(expect.objectContaining({
      elementId: "frame",
      effectiveBehavior: "morph",
      renderMode: "single",
    }));
    expect(compiled.operations[0]?.keyframes).toEqual([
      expect.objectContaining({ borderRadius: "20px" }),
      expect.objectContaining({ borderRadius: "4px 8px 12px 16px" }),
    ]);
  });

  it("resolves a none presence preset to a zero-duration cut", () => {
    const compiled = compileTransition(
      snapshot("from", []),
      snapshot("to", [text("title", 100)], { inPreset: "none", inDurationMultiplier: 2 }),
      edge(),
    );

    expect(compiled.operations[0]).toEqual(expect.objectContaining({
      type: "enter",
      effectiveBehavior: "cut",
      renderMode: "cut",
      timing: { durationMs: 0, delayMs: 100, easing: "ease-in-out" },
    }));
  });

  it("plays a persisted edge in reverse without changing its public document contract", () => {
    const persisted = edge({
      elementMotions: [{ elementId: "title", direction: "in", preset: "glide-left", durationMultiplier: 0.5, delayMs: 200 }],
    });
    const compiled = compileTransition(
      snapshot("to", [text("title", 300)]),
      snapshot("from", [text("title", 100)]),
      persisted,
    );

    expect(compiled.options).toBe(persisted);
    expect(compiled.operations[0]?.crossfadeTiming?.from).toEqual({
      durationMs: 400,
      delayMs: 200,
      easing: "ease-in",
    });
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

    const compiled = renderer.compileTransition(from, to, edge());
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

    renderer.compileTransition(from, to, edge());
    const playback = renderer.play();
    renderer.renderSlide(remote);

    await expect(playback).resolves.toBeUndefined();
    expect(animations.every(({ cancel }) => cancel.mock.calls.length === 1)).toBe(true);
    expect(host.querySelector('[data-element-id="title"]')?.textContent).toBe("Remote");
    expect(host.querySelectorAll('[data-element-id="title"]')).toHaveLength(1);
  });
});
