import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MOTION, mergeMotion, type DeksDocument, type MotionPatch, type PresenceAnimation } from "@deks-js/document";
import { compileTransition, RendererCore, type ElementSnapshot, type NumberElementSnapshot, type SlideSnapshot } from "../src/index.js";

const element = (id: string, patch: MotionPatch = {}, x = 100): ElementSnapshot => ({
  id, name: id, kind: "shape", shapeKind: "rectangle",
  rect: { x, y: 100, width: 300, height: 120 }, rotationDeg: 0, opacity: 1, zIndex: 1,
  fillStyle: { kind: "solid", color: "#73a7ff" }, motion: mergeMotion(DEFAULT_MOTION, patch),
});
const slide = (id: string, elements: ElementSnapshot[], patch: MotionPatch = {}): SlideSnapshot => ({
  id, canvas: { width: 1600, height: 900 }, background: { kind: "solid", color: "#101218" },
  motionBeatMs: 100, motion: mergeMotion(DEFAULT_MOTION, patch), elements,
});
const variants: PresenceAnimation[] = [
  { kind: "fade" }, { kind: "slide", edge: "left", distance: 80 },
  { kind: "crop", edge: "bottom" }, { kind: "wipe", edge: "left" },
  { kind: "scale", from: 0.8 }, { kind: "none" },
];

describe("returning across an authored boundary", () => {
  it.each(variants)("undoes $kind entry and exit instead of consulting the opposite roles", (animation) => {
    const a = slide("a", [element("old", { out: { animation, durationBeats: 2, delayMs: 40, easing: "ease-in" }, in: { animation: { kind: "none" } } })]);
    const b = slide("b", [element("new", { in: { animation, durationBeats: 3, delayMs: 260, easing: "ease-out" }, out: { animation: { kind: "none" } } })]);
    const forward = compileTransition(a, b);
    const backward = compileTransition(b, a, { direction: "reverse" });

    expect(backward.from).toBe(b);
    expect(backward.to).toBe(a);
    expect(backward.totalDurationMs).toBe(forward.totalDurationMs);
    for (const original of forward.operations) {
      const reversed = backward.operations.find(({ elementId }) => elementId === original.elementId)!;
      expect(reversed.type).toBe(original.type === "enter" ? "exit" : "enter");
      expect(reversed.keyframes).toEqual([...original.keyframes].reverse());
      expect(reversed.timing).toEqual({
        durationMs: original.timing.durationMs,
        delayMs: forward.totalDurationMs - original.timing.delayMs - original.timing.durationMs,
        easing: original.timing.easing === "ease-in" ? "ease-out" : "ease-in",
      });
      if (original.crop) expect(reversed.crop?.keyframes).toEqual([...original.crop.keyframes].reverse());
      if (original.wipe) expect(reversed.wipe?.keyframes).toEqual([...original.wipe.keyframes].reverse());
    }
  });

  it("keeps the forward morph owner and reverses the background, stagger and bezier curve", () => {
    const a = slide("a", [element("shared", { morph: { animation: { kind: "cut" } } }, 100)]);
    const b = slide("b", [element("shared", { morph: { durationBeats: 3, delayMs: 20, easing: [0.2, 0.1, 0.7, 0.8] } }, 700)], {
      morph: { durationBeats: 2, delayMs: 500, easing: "ease-in" },
    });
    b.background = { kind: "solid", color: "#ffffff" };
    const back = compileTransition(b, a, { direction: "reverse" });
    expect(back.totalDurationMs).toBe(700);
    expect(back.operations[0]).toMatchObject({ type: "change", effectiveBehavior: "morph", timing: { durationMs: 300, delayMs: 380 } });
    const curve = back.operations[0]!.timing.easing.match(/[\d.]+/g)!.map(Number);
    [0.3, 0.2, 0.8, 0.9].forEach((value, index) => expect(curve[index]).toBeCloseTo(value));
    expect(back).toMatchObject({ durationMs: 200, delayMs: 0, easing: "ease-out" });
  });

  it("reverses discrete crossfade layers without mutating endpoints", () => {
    const a = slide("a", [element("shared")]);
    const b = slide("b", [{ ...element("shared"), shapeKind: "ellipse" } as ElementSnapshot]);
    const source = JSON.stringify([a, b]);
    const forward = compileTransition(a, b).operations[0]!;
    const backward = compileTransition(b, a, { direction: "reverse" }).operations[0]!;
    expect(backward.renderMode).toBe("crossfade");
    expect(backward.crossfadeKeyframes?.from).toEqual([...forward.crossfadeKeyframes!.to].reverse());
    expect(backward.crossfadeKeyframes?.to).toEqual([...forward.crossfadeKeyframes!.from].reverse());
    expect(JSON.stringify([a, b])).toBe(source);
  });

  it("undoes number counts using the enabled forward role, including nonzero morph origins", () => {
    const number = (value: number): NumberElementSnapshot => ({
      id: "number", name: "Number", kind: "number", value,
      rect: { x: 100, y: 100, width: 300, height: 120 }, rotationDeg: 0, opacity: 1, zIndex: 1,
      motion: mergeMotion(DEFAULT_MOTION), animateMagnitude: { in: true, out: false, morph: true },
      decimals: 0, groupSeparator: ",", decimalSeparator: ".", symbol: "%", symbolPosition: "after",
      fontFamily: "Poppins", fontSize: 50, fontWeight: 600, lineHeight: 1.2, letterSpacing: 0,
      horizontalAlignment: "left", verticalAlignment: "top", color: "#ffffff", overflowMode: "hidden",
    });
    const empty = slide("empty", []);
    const measured = slide("measured", [number(75)]);
    expect(compileTransition(measured, empty, { direction: "reverse" }).operations[0]?.magnitude).toEqual({ from: 75, to: 0 });
    expect(compileTransition(measured, slide("earlier", [number(25)]), { direction: "reverse" }).operations[0]?.magnitude).toEqual({ from: 75, to: 25 });
    expect(compileTransition(empty, measured, { direction: "reverse" }).operations[0]?.magnitude).toBeUndefined();
  });

  it("infers reverse from document order even when skipping checkpoints", () => {
    const doc: DeksDocument = {
      format: "deks", codecVersion: 3, id: "deck", name: "Deck", revision: 0,
      canvas: { width: 1600, height: 900 }, motionBeatMs: 100, motion: mergeMotion(DEFAULT_MOTION),
      palette: { primary: "#ff7043", secondary: "#65c18c", accent: "#73a7ff", background: "#101218", text: "#ffffff", subtext: "#969da6" },
      history: { canUndo: false, canRedo: false }, assets: [],
      elements: [{ id: "bar", name: "Bar", kind: "shape", shapeKind: "rectangle", isLocked: false }],
      slides: ["a", "middle", "b"].map((id) => ({
        id, name: id, isTemplate: false, background: { kind: "solid", color: "#101218" },
        states: id === "b" ? [{ elementId: "bar", x: 100, y: 100, width: 300, height: 120, rotationDeg: 0, opacity: 1, zIndex: 1, shapeFill: { kind: "solid", color: "#73a7ff" }, stroke: "#73a7ff", strokeWidth: 0, motion: { in: { animation: { kind: "wipe", edge: "left" } }, out: { animation: { kind: "none" } } } }] : [],
      })),
    };
    const renderer = new RendererCore();
    renderer.mount(document.createElement("div"));
    const back = renderer.compileTransition(doc, "b", "a");
    expect(back.operations[0]).toMatchObject({ type: "exit", renderMode: "single", wipe: { keyframes: [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 100% 0 0)" }] } });
    renderer.destroy();
  });

  it("seeks and interrupts reverse playback without stale completion replacing the current scene", async () => {
    const animations: Array<{ currentTime: number; cancel: ReturnType<typeof vi.fn>; finished: Promise<void> }> = [];
    Element.prototype.animate = vi.fn(() => {
      let reject!: (error: unknown) => void;
      const animation = { currentTime: 0, playbackRate: 1, play: vi.fn(), pause: vi.fn(), cancel: vi.fn(() => reject(new DOMException("canceled", "AbortError"))), finished: new Promise<void>((_resolve, fail) => { reject = fail; }) };
      animations.push(animation);
      return animation as unknown as Animation;
    });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const host = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(host);
    const a = slide("a", []);
    const b = slide("b", [element("bar", { in: { animation: { kind: "wipe", edge: "left" } } })]);
    renderer.compileTransition(b, a, { direction: "reverse" });
    renderer.seek(50);
    expect(renderer.getPlaybackProgress()).toBe(0.5);
    expect(animations.every(({ currentTime }) => currentTime === 50)).toBe(true);
    const pending = renderer.play();
    renderer.compileTransition(a, b);
    renderer.seek(25);
    await pending;
    expect(renderer.getPlaybackProgress()).toBe(0.25);
    expect(host.querySelector('[data-element-id="bar"]')).not.toBeNull();
    renderer.destroy();
  });

  it("commits the earlier checkpoint immediately under reduced motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    Element.prototype.animate = vi.fn();
    const host = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(host);
    renderer.compileTransition(slide("b", [element("new")]), slide("a", [element("old")]), { direction: "reverse" });
    await renderer.play();
    expect(Element.prototype.animate).not.toHaveBeenCalled();
    expect([...host.querySelectorAll<HTMLElement>("[data-element-id]")].map((node) => node.dataset.elementId)).toEqual(["old"]);
    expect(renderer.getPlaybackProgress()).toBe(1);
    renderer.destroy();
  });
});
