import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MOTION, mergeMotion, type MotionSpec } from "@deks-js/document";
import {
  RendererCore,
  iconSvgMarkup,
  validateSnapshot,
  type ElementSnapshot,
  type SlideSnapshot,
} from "../src/index.js";

const motion = (): MotionSpec => mergeMotion(DEFAULT_MOTION);

const text = (id: string, x: number, content = id): ElementSnapshot => ({
  id,
  name: id,
  kind: "text",
  rect: { x, y: 80, width: 600, height: 120 },
  rotationDeg: 0,
  opacity: 1,
  zIndex: 2,
  motion: motion(),
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

const shape = (id: string, x: number): ElementSnapshot => ({
  id,
  name: id,
  kind: "shape",
  shapeKind: "rectangle",
  rect: { x, y: 240, width: 500, height: 280 },
  rotationDeg: 0,
  opacity: 0.8,
  zIndex: 1,
  motion: motion(),
  fillStyle: { kind: "solid", color: "#ff7043" },
  stroke: "#ffffff",
  strokeWidth: 2,
  cornerRadii: { topLeft: 24, topRight: 24, bottomRight: 24, bottomLeft: 24 },
});

const slide = (id = "slide-a", elements: ElementSnapshot[] = [text("title", 100), shape("box", 50)]): SlideSnapshot => ({
  id,
  canvas: { width: 1920, height: 1080 },
  background: { kind: "solid", color: id === "slide-a" ? "#111111" : "#222222" },
  motionBeatMs: 600,
  motion: motion(),
  elements,
});

class PendingAnimation {
  currentTime: CSSNumberish | null = 0;
  playbackRate = 1;
  playState: AnimationPlayState = "paused";
  effect = { getComputedTiming: () => ({ progress: typeof this.currentTime === "number" ? this.currentTime / 600 : 0 }) };
  play = vi.fn(() => { this.playState = "running"; });
  pause = vi.fn(() => { this.playState = "paused"; });
  cancel = vi.fn(() => {
    this.playState = "idle";
    this.rejectFinished(new DOMException("Animation canceled", "AbortError"));
  });
  private rejectFinished!: (reason: unknown) => void;
  finished = new Promise<void>((_resolve, reject) => {
    this.rejectFinished = reject;
  });
}

class FinishesOnlyWhenPlayed {
  currentTime: CSSNumberish | null = 0;
  playbackRate = 1;
  playState: AnimationPlayState = "paused";
  pause = vi.fn(() => { this.playState = "paused"; });
  cancel = vi.fn();
  private resolveFinished!: () => void;
  finished = new Promise<void>((resolve) => { this.resolveFinished = resolve; });
  play = vi.fn(() => {
    this.playState = "running";
    queueMicrotask(() => {
      this.playState = "finished";
      this.resolveFinished();
    });
  });
}

describe("shared editor and playback renderer contract", () => {
  let animations: PendingAnimation[];

  beforeEach(() => {
    animations = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });
    Element.prototype.animate = vi.fn(() => {
      const animation = new PendingAnimation();
      animations.push(animation);
      return animation as unknown as Animation;
    });
  });

  it("previews and restores an atomic element batch without replacing the canonical scene", () => {
    const host = document.createElement("div");
    const renderer = new RendererCore();
    const canonical = slide();
    renderer.mount(host);
    renderer.renderSlide(canonical);
    const content = host.querySelector<HTMLElement>("[data-deks-content]")!;
    const title = host.querySelector<HTMLElement>('[data-element-id="title"]')!;
    const box = host.querySelector<HTMLElement>('[data-element-id="box"]')!;
    const replaceChildren = vi.spyOn(content, "replaceChildren");

    expect(renderer.setSelection(["title", "box"])).toBe(true);
    expect(title.dataset.deksSelected).toBe("");
    expect(box.dataset.deksSelected).toBe("");
    expect(renderer.previewElements([
      { ...canonical.elements[0]!, rect: { x: 300, y: 200, width: 700, height: 160 }, rotationDeg: 12 },
      { ...canonical.elements[1]!, rect: { x: 250, y: 300, width: 800, height: 400 }, opacity: 0.4 },
    ])).toBe(true);
    expect(title.style.left).toBe(`${(300 / 1920) * 100}%`);
    expect(title.style.transform).toBe("rotate(12deg)");
    expect(box.style.opacity).toBe("0.4");
    expect(renderer.measureLayout().find(({ elementId }) => elementId === "title")?.rect)
      .toEqual(canonical.elements[0]!.rect);

    const beforeRejectedBatch = title.getAttribute("style");
    expect(renderer.previewElements([
      { ...canonical.elements[0]!, rect: { x: 999, y: 200, width: 700, height: 160 } },
      { ...canonical.elements[1]!, id: "missing" },
    ])).toBe(false);
    expect(title.getAttribute("style")).toBe(beforeRejectedBatch);

    expect(renderer.restoreElements(["title", "box"])).toBe(true);
    expect(title.style.left).toBe(`${(100 / 1920) * 100}%`);
    expect(title.style.transform).toBe("rotate(0deg)");
    expect(box.style.opacity).toBe("0.8");
    expect(replaceChildren).not.toHaveBeenCalled();
  });

  it("renders a faithful, independent onion snapshot and clears it without touching the active scene", () => {
    const host = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(host);
    renderer.renderSlide(slide());
    const activeTitle = host.querySelector<HTMLElement>('[data-element-id="title"]')!;
    const previous = slide("previous", [text("title", -80, "Antes"), shape("box", 20)]);

    renderer.setOnionSkin(previous, { opacity: 0.24 });

    const onion = host.querySelector<HTMLElement>("[data-deks-onion]")!;
    expect(onion.style.opacity).toBe("0.24");
    expect(onion.style.pointerEvents).toBe("none");
    expect(onion.getAttribute("aria-hidden")).toBe("true");
    expect(onion.querySelector('[data-onion-element-id="title"]')?.textContent).toBe("Antes");
    expect(onion.querySelector("[data-element-id]")).toBeNull();
    expect(host.querySelector('[data-element-id="title"]')).toBe(activeTitle);

    renderer.setOnionSkin(null);
    expect(host.querySelector("[data-deks-onion]")).toBeNull();
    expect(host.querySelector('[data-element-id="title"]')).toBe(activeTitle);
  });

  it("seeks, changes rate and publishes progress from the renderer-owned WAAPI clock", async () => {
    let nextFrameId = 1;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { frames.delete(id); }));
    const renderer = new RendererCore();
    renderer.mount(document.createElement("div"));
    const from = slide();
    const to = slide("slide-b", [text("title", 700), shape("box", 50)]);
    renderer.compileTransition(from, to);
    const progress: number[] = [];
    const unsubscribe = renderer.subscribePlaybackProgress((value) => progress.push(value));

    renderer.seek(300);
    expect(animations.length).toBeGreaterThan(0);
    expect(animations.every(({ currentTime }) => currentTime === 300)).toBe(true);
    expect(renderer.getPlaybackProgress()).toBe(0.5);
    expect(progress.at(-1)).toBe(0.5);

    renderer.setPlaybackRate(0.5);
    expect(animations.every(({ playbackRate }) => playbackRate === 0.5)).toBe(true);
    const playback = renderer.play();
    expect(animations.every(({ play }) => play.mock.calls.length >= 2)).toBe(true);
    expect(frames.size).toBe(1);
    renderer.pause();
    expect(frames.size).toBe(0);
    renderer.stop();
    expect(renderer.getPlaybackProgress()).toBe(0);

    unsubscribe();
    renderer.destroy();
    await expect(playback).resolves.toBeUndefined();
  });

  it("keeps native number magnitude metadata when the editor scrubs a transition", () => {
    const number = (value: number): ElementSnapshot => ({
      id: "metric",
      name: "Metric",
      kind: "number",
      rect: { x: 100, y: 100, width: 600, height: 180 },
      rotationDeg: 0,
      opacity: 1,
      zIndex: 1,
      motion: motion(),
      value,
      decimals: 0,
      groupSeparator: "none",
      decimalSeparator: "dot",
      symbol: "",
      symbolPosition: "suffix",
      animateMagnitude: { in: true, morph: true, out: false },
      fontFamily: "Poppins",
      fontSize: 120,
      fontWeight: 700,
      lineHeight: 1,
      letterSpacing: 0,
      horizontalAlignment: "left",
      verticalAlignment: "top",
      color: "#ffffff",
      overflowMode: "hidden",
    });
    const renderer = new RendererCore();
    const host = document.createElement("div");
    renderer.mount(host);
    const compiled = renderer.compileTransition(slide("slide-a", [number(42)]), slide("slide-b", [number(128)]));

    expect(compiled.operations[0]?.magnitude).toEqual({ from: 42, to: 128 });
    renderer.seek(300);
    expect(host.querySelector('[data-element-id="metric"]')?.textContent).not.toBe("42");
  });

  it("explicitly starts every delayed WAAPI animation and commits one destination scene", async () => {
    const started: FinishesOnlyWhenPlayed[] = [];
    Element.prototype.animate = vi.fn(() => {
      const animation = new FinishesOnlyWhenPlayed();
      started.push(animation);
      return animation as unknown as Animation;
    });
    const entrance = (
      id: string,
      animation: MotionSpec["in"]["animation"],
      delayBeats: number,
    ): ElementSnapshot => ({
      ...shape(id, delayBeats * 200),
      motion: mergeMotion(DEFAULT_MOTION, {
        in: { animation, durationBeats: 1, delayBeats },
      }),
    });
    const host = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(host);
    renderer.compileTransition(
      slide("slide-a", []),
      slide("slide-b", [
        entrance("fade", { kind: "fade" }, 1),
        entrance("wipe", { kind: "wipe", edge: "right" }, 2),
        entrance("crop", { kind: "crop", edge: "left" }, 3),
      ]),
    );

    await renderer.play();

    expect(started.length).toBeGreaterThanOrEqual(4);
    expect(started.every(({ play }) => play.mock.calls.length === 1)).toBe(true);
    expect([...host.querySelectorAll<HTMLElement>("[data-element-id]")].map((node) => node.dataset.elementId).sort())
      .toEqual(["crop", "fade", "wipe"]);
    expect(host.querySelector("[data-deks-crop]")).toBeNull();
    expect(renderer.getPlaybackProgress()).toBe(1);
  });

  it("does not recurse when a host test shim invokes requestAnimationFrame synchronously", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const renderer = new RendererCore();
    renderer.mount(document.createElement("div"));
    renderer.compileTransition(slide(), slide("slide-b", [text("title", 700)]));

    expect(() => { void renderer.play(); }).not.toThrow();
    renderer.pause();
    renderer.destroy();
  });
});

describe("shared renderer helpers", () => {
  it("validates snapshots and serializes only registered safe icon SVG", () => {
    expect(() => validateSnapshot(slide())).not.toThrow();
    const svg = iconSvgMarkup("shield-check", "#5EEAD4", 2);
    expect(svg).toContain('stroke="#5EEAD4"');
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(() => iconSvgMarkup("shield-check", '#fff" onload="alert(1)', 2)).toThrow("six-digit hex");
    expect(() => validateSnapshot({ ...slide(), canvas: { width: 0, height: 1080 } })).toThrow("canvas.width");
  });
});
