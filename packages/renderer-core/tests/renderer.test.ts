import { beforeEach, describe, expect, it, vi } from "vitest";
import { RendererCore } from "../src/index.js";
import type { Easing, SlideBackground, SlideSnapshot, TransitionOptions } from "../src/index.js";

class FakeAnimation {
  currentTime: number | null = 0;
  playbackRate = 1;
  playState: AnimationPlayState = "paused";
  finished = Promise.resolve(this as unknown as Animation);
  pause = vi.fn(() => { this.playState = "paused"; });
  play = vi.fn(() => { this.playState = "running"; });
  cancel = vi.fn(() => { this.playState = "idle"; });
}

class PendingAnimation extends FakeAnimation {
  private rejectFinished!: (reason: unknown) => void;
  override finished = new Promise<Animation>((_resolve, reject) => {
    this.rejectFinished = reject;
  });
  override cancel = vi.fn(() => {
    this.playState = "idle";
    this.rejectFinished(new DOMException("Animation canceled", "AbortError"));
  });
}

class ControlledAnimation extends FakeAnimation {
  private resolveFinished!: (animation: Animation) => void;
  override finished = new Promise<Animation>((resolve) => {
    this.resolveFinished = resolve;
  });
  finish(): void {
    this.playState = "finished";
    this.resolveFinished(this as unknown as Animation);
  }
}

const snapshot = (): SlideSnapshot => ({
  id: "slide-a",
  canvas: { width: 1920, height: 1080 },
  elements: [
    {
      id: "title", kind: "text", rect: { x: 100, y: 80, width: 600, height: 120 },
      rotationDeg: 0, opacity: 1, zIndex: 2, content: "Hola", fontFamily: "Poppins",
      fontSize: 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: 0,
      horizontalAlignment: "center", verticalAlignment: "middle", color: "#fff"
    },
    {
      id: "box", kind: "shape", shapeKind: "rectangle",
      rect: { x: 50, y: 50, width: 800, height: 300 }, rotationDeg: 0, opacity: 0.8,
      zIndex: 1, fillStyle: { kind: "solid", color: "#123456" }, stroke: "#fff", strokeWidth: 2,
      cornerRadii: { topLeft: 24, topRight: 24, bottomRight: 24, bottomLeft: 24 },
    },
    {
      id: "photo", kind: "image", rect: { x: 900, y: 100, width: 640, height: 480 },
      rotationDeg: 2, opacity: 1, zIndex: 3, src: "/assets/photo", alt: "Demo", fit: "cover"
    }
  ]
});

const timing = (
  motionBeatMs: number,
  delayMs = 0,
  easing: Easing = "linear"
): TransitionOptions => ({ motionBeatMs, durationMultiplier: 1, delayMs, easing });

const backgroundSnapshot = (id: string, background: SlideBackground): SlideSnapshot => ({
  id,
  canvas: { width: 1920, height: 1080 },
  background,
  elements: [],
});

const expectRenderedBackground = (layer: HTMLElement, background: SlideBackground): void => {
  if (background.kind === "solid") {
    const normalizedColor = document.createElement("div");
    normalizedColor.style.backgroundColor = background.color;
    expect(layer.style.backgroundColor).toBe(normalizedColor.style.backgroundColor);
    expect(layer.style.backgroundImage).toBe("none");
    return;
  }
  expect(layer.style.backgroundColor).toBe("transparent");
  expect(layer.style.backgroundImage)
    .toBe(`linear-gradient(${background.angleDeg}deg, ${background.startColor}, ${background.endColor})`);
};

describe("RendererCore", () => {
  it("renders catalog icons as safe inline SVG without network access", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const renderer = new RendererCore();
    const host = document.createElement("div");
    renderer.mount(host);
    renderer.renderSlide({
      id: "icons", canvas: { width: 1920, height: 1080 }, elements: [{
        id: "governance", kind: "icon", family: "lucide", iconName: "shield-check",
        color: "#5EEAD4", strokeWidth: 2, semanticRole: "Governance",
        rect: { x: 100, y: 100, width: 128, height: 128 }, rotationDeg: 0, opacity: 1, zIndex: 1,
      }],
    });
    const svg = host.querySelector<SVGSVGElement>("[data-element-id=governance] svg")!;
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.querySelectorAll("path")).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects icon colors that could escape serialized SVG attributes", () => {
    const renderer = new RendererCore();
    renderer.mount(document.createElement("div"));

    expect(() => renderer.renderSlide({
      id: "unsafe-icon", canvas: { width: 1920, height: 1080 }, elements: [{
        id: "governance", kind: "icon", family: "lucide", iconName: "shield-check",
        color: "#fff\" onload=\"alert(1)", strokeWidth: 2,
        rect: { x: 100, y: 100, width: 128, height: 128 }, rotationDeg: 0, opacity: 1, zIndex: 1,
      }],
    })).toThrow("governance.color is invalid");
  });

  it("activa botones HTTPS sólo en presentación mediante un callback del host", () => {
    const opened: string[] = [];
    const renderer = new RendererCore({ onOpenExternal: (url) => opened.push(url) });
    const host = document.createElement("div");
    renderer.mount(host);
    renderer.renderSlide({
      id: "slide", canvas: { width: 1920, height: 1080 }, elements: [{
        id: "cta", kind: "link-button", rect: { x: 10, y: 10, width: 320, height: 90 },
        rotationDeg: 0, opacity: 1, zIndex: 1, label: "Ver sitio", url: "https://deks.eigen.cl",
        fill: "#ff7043", textColor: "#1a0904", fontFamily: "Poppins", fontSize: 32,
        fontWeight: 600, cornerRadius: 16, stroke: "#ff7043", strokeWidth: 0,
      }],
    });
    const button = host.querySelector<HTMLButtonElement>("button[data-deks-external-link]")!;
    expect(button.tabIndex).toBe(0);
    button.click();
    expect(opened).toEqual(["https://deks.eigen.cl/"]);
    renderer.setViewportMode("editor");
    expect(button.tabIndex).toBe(-1);
    button.click();
    expect(opened).toHaveLength(1);
  });

  it("rechaza protocolos activos en botones externos", () => {
    const renderer = new RendererCore();
    const host = document.createElement("div");
    renderer.mount(host);
    expect(() => renderer.renderSlide({
      id: "slide", canvas: { width: 100, height: 100 }, elements: [{
        id: "bad", kind: "link-button", rect: { x: 0, y: 0, width: 10, height: 10 }, rotationDeg: 0,
        opacity: 1, zIndex: 1, label: "X", url: "javascript:alert(1)", fill: "#000000",
        textColor: "#ffffff", fontFamily: "Roboto", fontSize: 12, fontWeight: 500,
        cornerRadius: 0, stroke: "#000000", strokeWidth: 0,
      }],
    })).toThrow("https URL");
  });
  let animations: FakeAnimation[];

  beforeEach(() => {
    animations = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false }))
    });
    Element.prototype.animate = vi.fn(() => {
      const animation = new FakeAnimation();
      animations.push(animation);
      return animation as unknown as Animation;
    });
  });

  it("renders text, CSS shapes, and images in absolute canonical rectangles", () => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    renderer.renderSlide(snapshot());

    const stage = container.querySelector<HTMLElement>("[data-deks-stage]");
    expect(stage?.style.width).toBe("1920px");
    expect(stage?.style.height).toBe("1080px");
    expect(stage?.style.isolation).toBe("isolate");
    expect(stage?.querySelector('[data-element-id="title"]')?.textContent).toBe("Hola");
    expect(stage?.querySelector<HTMLElement>('[data-element-id="box"]')?.style.borderRadius).toBe("24px 24px 24px 24px");
    expect(stage?.querySelector<HTMLElement>('[data-element-id="photo"] [data-element-content]')?.style.backgroundImage).toContain("/assets/photo");
    expect(stage?.querySelector<HTMLElement>('[data-element-id="photo"]')?.style.transform)
      .toBe("rotate(2deg)");
    expect(stage?.querySelector<HTMLElement>('[data-element-id="photo"]')?.style.left).toBe("900px");
    expect(stage?.querySelector<HTMLElement>('[data-element-id="photo"]')?.style.top).toBe("100px");
  });

  it("renders an image whose asset the host could not resolve as an accessible placeholder", () => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const unresolved = snapshot();
    delete (unresolved.elements.find((element) => element.id === "photo") as { src?: string }).src;

    expect(() => renderer.renderSlide(unresolved)).not.toThrow();

    const content = container.querySelector<HTMLElement>('[data-element-id="photo"] [data-element-content]');
    expect(content?.style.backgroundImage).toBe("none");
    expect(content?.getAttribute("aria-label")).toBe("Demo");
  });

  it("renders canonical rectangle radii per corner", () => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const slide = snapshot();
    const box = slide.elements.find((element) => element.id === "box");
    if (!box || box.kind !== "shape") throw new Error("fixture must contain box shape");
    box.cornerRadii = { topLeft: 8, topRight: 16, bottomRight: 24, bottomLeft: 32 };

    renderer.renderSlide(slide);

    expect(container.querySelector<HTMLElement>('[data-element-id="box"]')?.style.borderRadius)
      .toBe("8px 16px 24px 32px");
  });

  it("fits rectangle, ellipse, and line CSS geometry exactly inside their absolute wrappers", () => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const shapeBase = {
      kind: "shape" as const,
      rect: { x: 20, y: 30, width: 300, height: 120 },
      rotationDeg: 0,
      opacity: 1,
      zIndex: 1,
      stroke: "#000",
      strokeWidth: 4
    };
    renderer.renderSlide({
      id: "shapes",
      canvas: { width: 1920, height: 1080 },
      elements: [
        { ...shapeBase, id: "rect", shapeKind: "rectangle", fillStyle: { kind: "solid", color: "#fff" } },
        { ...shapeBase, id: "ellipse", shapeKind: "ellipse", zIndex: 2, fillStyle: { kind: "solid", color: "#fff" } },
        { ...shapeBase, id: "line", shapeKind: "line", zIndex: 3, fillStyle: { kind: "solid", color: "#00000000" } }
      ]
    });

    for (const id of ["rect", "ellipse"]) {
      const wrapper = container.querySelector<HTMLElement>(`[data-element-id="${id}"]`)!;
      const content = wrapper.querySelector<HTMLElement>("[data-element-content]")!;
      expect(wrapper.style.width).toBe("300px");
      expect(wrapper.style.height).toBe("120px");
      expect(content.style.width).toBe("100%");
      expect(content.style.height).toBe("100%");
      expect(content.style.boxSizing).toBe("border-box");
      expect(wrapper.style.borderStyle).not.toBe("solid");
      expect(content.style.borderStyle).toBe("solid");
      expect(content.style.borderWidth).toBe("4px");
    }
    const lineWrapper = container.querySelector<HTMLElement>('[data-element-id="line"]')!;
    const lineContent = lineWrapper.querySelector<HTMLElement>("[data-element-content]")!;
    expect(lineWrapper.style.width).toBe("300px");
    expect(lineWrapper.style.height).toBe("120px");
    expect(lineContent.style.width).toBe("100%");
    expect(lineContent.style.height).toBe("4px");
    expect(lineContent.style.boxSizing).toBe("border-box");
    expect(container.querySelector<HTMLElement>('[data-element-id="rect"]')?.style.borderWidth).toBe("4px");
    expect(container.querySelector<HTMLElement>('[data-element-id="ellipse"]')?.style.borderRadius).toBe("50%");
    const line = container.querySelector<HTMLElement>('[data-element-id="line"] [data-element-content]')!;
    expect(line.style.height).toBe("4px");
    expect(line.style.width).toBe("100%");
  });

  it("renders linear-gradient fills on rectangles and ellipses without affecting lines", () => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const gradient = { kind: "linear-gradient" as const, angleDeg: 125, startColor: "#FF7043", endColor: "#73A7FF" };
    const base = { kind: "shape" as const, rect: { x: 0, y: 0, width: 200, height: 200 }, rotationDeg: 0, opacity: 1, zIndex: 1 };
    renderer.renderSlide({
      id: "gradient-shapes", canvas: { width: 800, height: 600 }, elements: [
        { ...base, id: "rect-gradient", shapeKind: "rectangle", fillStyle: gradient },
        { ...base, id: "ellipse-gradient", shapeKind: "ellipse", fillStyle: gradient },
        { ...base, id: "line-gradient", shapeKind: "line", stroke: "#F2F1EC", strokeWidth: 8, fillStyle: gradient },
      ],
    });

    expect(container.querySelector<HTMLElement>('[data-element-id="rect-gradient"]')?.style.backgroundImage)
      .toBe("linear-gradient(125deg, #FF7043, #73A7FF)");
    expect(container.querySelector<HTMLElement>('[data-element-id="ellipse-gradient"]')?.style.backgroundImage)
      .toBe("linear-gradient(125deg, #FF7043, #73A7FF)");
    expect(container.querySelector<HTMLElement>('[data-element-id="line-gradient"] [data-element-content]')?.style.backgroundImage)
      .toBe("none");
  });

  it("compiles WAAPI animations and keeps seek, pause, and play on one logical clock", async () => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const from = snapshot();
    const to: SlideSnapshot = {
      ...from,
      id: "slide-b",
      elements: from.elements.map((element) => element.id === "title"
        ? { ...element, rect: { ...element.rect, x: 700 }, opacity: 0.5 }
        : element)
    };

    const compiled = renderer.compileTransition(from, to, timing(800, 200, "cubic-bezier(0.2, 0.5, 0.8, 1)"));
    renderer.seek(350);
    renderer.pause();
    await renderer.play();

    expect(compiled.totalDurationMs).toBe(1000);
    expect(animations).toHaveLength(3);
    expect(animations.every((animation) => animation.currentTime === 350)).toBe(true);
    expect(animations.every((animation) => animation.pause.mock.calls.length >= 1)).toBe(true);
    expect(animations.every((animation) => animation.play.mock.calls.length === 1)).toBe(true);
  });

  it("changes playback rate and stops every animation at the start of the compiled transition", () => {
    const renderer = new RendererCore();
    renderer.mount(document.createElement("div"));
    const from = snapshot();
    const to: SlideSnapshot = { ...from, id: "slide-b", elements: [] };

    renderer.compileTransition(from, to, timing(800));
    renderer.seek(500);
    renderer.setPlaybackRate(0.5);
    renderer.stop();

    expect(animations.every((animation) => animation.playbackRate === 0.5)).toBe(true);
    expect(animations.every((animation) => animation.currentTime === 0)).toBe(true);
    expect(animations.every((animation) => animation.pause.mock.calls.length >= 2)).toBe(true);
    expect(() => renderer.setPlaybackRate(0)).toThrow("playback rate");
  });

  it("treats stop as an idempotent no-op before a transition is compiled", () => {
    const renderer = new RendererCore();
    renderer.mount(document.createElement("div"));

    expect(() => renderer.stop()).not.toThrow();
    expect(renderer.getPlaybackProgress()).toBe(0);
  });

  it("publishes normalized WAAPI playback progress without requiring React frame renders", async () => {
    const pending: PendingAnimation[] = [];
    Element.prototype.animate = vi.fn(() => {
      const animation = new PendingAnimation();
      pending.push(animation);
      return animation as unknown as Animation;
    });
    let nextFrameId = 1;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, callback);
      return id;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => {
      frames.delete(id);
    }));
    const renderer = new RendererCore();
    renderer.mount(document.createElement("div"));
    const from = snapshot();
    const to: SlideSnapshot = { ...from, id: "slide-b", elements: [] };
    renderer.compileTransition(from, to, timing(800, 200));
    const progress: number[] = [];
    const unsubscribe = renderer.subscribePlaybackProgress((value) => progress.push(value));

    expect(progress).toEqual([0]);
    expect(renderer.getPlaybackProgress()).toBe(0);
    const playback = renderer.play();
    expect(frames).toHaveLength(1);

    for (const animation of pending) animation.currentTime = 250;
    const firstFrame = [...frames.entries()][0]!;
    frames.delete(firstFrame[0]);
    firstFrame[1](16);
    expect(renderer.getPlaybackProgress()).toBe(0.25);
    expect(progress.at(-1)).toBe(0.25);
    expect(frames).toHaveLength(1);

    for (const animation of pending) animation.currentTime = 400;
    renderer.pause();
    expect(renderer.getPlaybackProgress()).toBe(0.4);
    expect(progress.at(-1)).toBe(0.4);
    expect(frames).toHaveLength(0);

    renderer.seek(900);
    expect(renderer.getPlaybackProgress()).toBe(0.9);
    renderer.stop();
    expect(renderer.getPlaybackProgress()).toBe(0);
    expect(progress.at(-1)).toBe(0);

    unsubscribe();
    renderer.seek(500);
    expect(renderer.getPlaybackProgress()).toBe(0.5);
    expect(progress.at(-1)).toBe(0);
    renderer.destroy();
    await expect(playback).resolves.toBeUndefined();
    expect(frames).toHaveLength(0);
  });

  it("keeps completed playback at one and stops its animation-frame sampler", async () => {
    const controlled: ControlledAnimation[] = [];
    Element.prototype.animate = vi.fn(() => {
      const animation = new ControlledAnimation();
      controlled.push(animation);
      return animation as unknown as Animation;
    });
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const id = frames.size + 1;
      frames.set(id, callback);
      return id;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => {
      frames.delete(id);
    }));
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const from = snapshot();
    const to: SlideSnapshot = { ...from, id: "slide-b", elements: [] };
    renderer.compileTransition(from, to, timing(800));
    const progress: number[] = [];
    renderer.subscribePlaybackProgress((value) => progress.push(value));

    const playback = renderer.play();
    for (const animation of controlled) {
      animation.currentTime = 800;
      animation.finish();
    }
    await playback;

    expect(renderer.getPlaybackProgress()).toBe(1);
    expect(progress.at(-1)).toBe(1);
    expect(frames).toHaveLength(0);
    expect(container.querySelectorAll("[data-element-id]")).toHaveLength(0);
  });

  it("does not leak a frame when a progress subscriber pauses playback reentrantly", async () => {
    const pending: PendingAnimation[] = [];
    Element.prototype.animate = vi.fn(() => {
      const animation = new PendingAnimation();
      pending.push(animation);
      return animation as unknown as Animation;
    });
    let nextFrameId = 1;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, callback);
      return id;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => {
      frames.delete(id);
    }));
    const renderer = new RendererCore();
    renderer.mount(document.createElement("div"));
    const from = snapshot();
    renderer.compileTransition(from, { ...from, id: "slide-b", elements: [] }, timing(800));
    renderer.subscribePlaybackProgress((progress) => {
      if (progress > 0) renderer.pause();
    });

    const playback = renderer.play();
    for (const animation of pending) animation.currentTime = 200;
    const frame = [...frames.entries()][0]!;
    frames.delete(frame[0]);
    frame[1](16);

    expect(renderer.getPlaybackProgress()).toBe(0.25);
    expect(frames).toHaveLength(0);
    renderer.destroy();
    await expect(playback).resolves.toBeUndefined();
  });

  it.each([
    {
      flow: "solid to solid",
      fromBackground: { kind: "solid", color: "#111111" } satisfies SlideBackground,
      toBackground: { kind: "solid", color: "#fefefe" } satisfies SlideBackground,
    },
    {
      flow: "solid to gradient",
      fromBackground: { kind: "solid", color: "#111111" } satisfies SlideBackground,
      toBackground: {
        kind: "linear-gradient", angleDeg: 120, startColor: "#ff7043", endColor: "#73a7ff",
      } satisfies SlideBackground,
    },
    {
      flow: "gradient to solid",
      fromBackground: {
        kind: "linear-gradient", angleDeg: 15, startColor: "#17223b", endColor: "#ff7043",
      } satisfies SlideBackground,
      toBackground: { kind: "solid", color: "#f2f1ec" } satisfies SlideBackground,
    },
    {
      flow: "gradient to gradient",
      fromBackground: {
        kind: "linear-gradient", angleDeg: 15, startColor: "#17223b", endColor: "#ff7043",
      } satisfies SlideBackground,
      toBackground: {
        kind: "linear-gradient", angleDeg: 210, startColor: "#73a7ff", endColor: "#1a0904",
      } satisfies SlideBackground,
    },
  ])("crossfades $flow with the destination below the fading source", ({ fromBackground, toBackground }) => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const from = backgroundSnapshot("slide-a", fromBackground);
    const to = backgroundSnapshot("slide-b", toBackground);

    const compiled = renderer.compileTransition(from, to, timing(
      800,
      125,
      "cubic-bezier(0.2, 0.5, 0.8, 1)",
    ));

    const stage = container.querySelector<HTMLElement>("[data-deks-stage]")!;
    const layers = stage.querySelectorAll<HTMLElement>(":scope > [data-deks-background]");
    expect(layers).toHaveLength(2);
    expect(layers[0]?.dataset.deksBackground).toBe("incoming");
    expect(layers[1]?.dataset.deksBackground).toBe("outgoing");
    expectRenderedBackground(layers[0]!, toBackground);
    expectRenderedBackground(layers[1]!, fromBackground);
    expect(layers[0]?.style.zIndex).toBe("-2");
    expect(layers[1]?.style.zIndex).toBe("-2");

    expect(compiled).toEqual(expect.objectContaining({
      durationMs: 800,
      delayMs: 125,
      easing: "cubic-bezier(0.2, 0.5, 0.8, 1)",
    }));
    expect(Element.prototype.animate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Element.prototype.animate).mock.calls[0]?.[0]).toEqual([
      { opacity: 1 },
      { opacity: 0 },
    ]);
    expect(vi.mocked(Element.prototype.animate).mock.calls[0]?.[1]).toEqual({
      duration: 800,
      delay: 125,
      easing: "cubic-bezier(0.2, 0.5, 0.8, 1)",
      fill: "both",
    });
  });

  it("keeps the background crossfade on the renderer clock for seek and playback rate", () => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const fromBackground: SlideBackground = { kind: "solid", color: "#111111" };
    const toBackground: SlideBackground = {
      kind: "linear-gradient", angleDeg: 90, startColor: "#ff7043", endColor: "#73a7ff",
    };
    const from = backgroundSnapshot("slide-a", fromBackground);
    const to = backgroundSnapshot("slide-b", toBackground);

    renderer.compileTransition(from, to, timing(800, 200));
    renderer.seek(450);
    renderer.setPlaybackRate(0.5);
    renderer.pause();

    expect(animations).toHaveLength(1);
    expect(animations[0]?.currentTime).toBe(450);
    expect(animations[0]?.playbackRate).toBe(0.5);
    expect(animations[0]?.pause.mock.calls.length).toBeGreaterThanOrEqual(2);

    renderer.stop();

    expect(animations[0]?.currentTime).toBe(0);
    const layers = container.querySelectorAll<HTMLElement>("[data-deks-background]");
    expect(layers).toHaveLength(2);
    expect(layers[0]?.dataset.deksBackground).toBe("incoming");
    expectRenderedBackground(layers[0]!, toBackground);
    expect(layers[1]?.dataset.deksBackground).toBe("outgoing");
    expectRenderedBackground(layers[1]!, fromBackground);
  });

  it("does not create a second layer or animation when the background is unchanged", () => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const background: SlideBackground = {
      kind: "linear-gradient", angleDeg: 90, startColor: "#ff7043", endColor: "#73a7ff",
    };

    renderer.compileTransition(
      backgroundSnapshot("slide-a", background),
      backgroundSnapshot("slide-b", { ...background }),
      timing(800, 200),
    );

    const layers = container.querySelectorAll<HTMLElement>("[data-deks-background]");
    expect(layers).toHaveLength(1);
    expect(layers[0]?.dataset.deksBackground).toBe("current");
    expectRenderedBackground(layers[0]!, background);
    expect(Element.prototype.animate).not.toHaveBeenCalled();
    expect(animations).toHaveLength(0);
  });

  it("reduces a background crossfade to a zero-duration, zero-delay cut", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true }))
    });
    const renderer = new RendererCore();
    renderer.mount(document.createElement("div"));
    const from = backgroundSnapshot("slide-a", { kind: "solid", color: "#111111" });
    const to = backgroundSnapshot("slide-b", {
      kind: "linear-gradient", angleDeg: 90, startColor: "#ff7043", endColor: "#73a7ff",
    });

    const compiled = renderer.compileTransition(from, to, timing(800, 200, "ease-in-out"));

    expect(compiled).toEqual(expect.objectContaining({ durationMs: 800, delayMs: 200 }));
    expect(vi.mocked(Element.prototype.animate).mock.calls[0]?.[0]).toEqual([
      { opacity: 1 },
      { opacity: 0 },
    ]);
    expect(vi.mocked(Element.prototype.animate).mock.calls[0]?.[1]).toEqual({
      duration: 0,
      delay: 0,
      easing: "ease-in-out",
      fill: "both",
    });
  });

  it("commits one canonical destination background after the crossfade finishes", async () => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const from = backgroundSnapshot("slide-a", { kind: "solid", color: "#111111" });
    const toBackground: SlideBackground = {
      kind: "linear-gradient", angleDeg: 90, startColor: "#ff7043", endColor: "#73a7ff",
    };
    const to = backgroundSnapshot("slide-b", toBackground);

    renderer.compileTransition(from, to, timing(800));
    await renderer.play();

    const layers = container.querySelectorAll<HTMLElement>("[data-deks-background]");
    expect(layers).toHaveLength(1);
    expect(layers[0]?.dataset.deksBackground).toBe("current");
    expectRenderedBackground(layers[0]!, toBackground);
  });

  it("removes both transient background layers when a canonical render interrupts playback", async () => {
    const pending: PendingAnimation[] = [];
    Element.prototype.animate = vi.fn(() => {
      const animation = new PendingAnimation();
      pending.push(animation);
      return animation as unknown as Animation;
    });
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const from = backgroundSnapshot("slide-a", { kind: "solid", color: "#111111" });
    const target = backgroundSnapshot("slide-b", {
      kind: "linear-gradient", angleDeg: 90, startColor: "#ff7043", endColor: "#73a7ff",
    });
    const remoteBackground: SlideBackground = { kind: "solid", color: "#f2f1ec" };

    renderer.compileTransition(from, target, timing(800));
    const playback = renderer.play();
    renderer.renderSlide(backgroundSnapshot("remote", remoteBackground));

    await expect(playback).resolves.toBeUndefined();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.cancel).toHaveBeenCalledOnce();
    const layers = container.querySelectorAll<HTMLElement>("[data-deks-background]");
    expect(layers).toHaveLength(1);
    expect(layers[0]?.dataset.deksBackground).toBe("current");
    expectRenderedBackground(layers[0]!, remoteBackground);
  });

  it("reports canonical geometry and measured text overflow, then cleans up", () => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    renderer.renderSlide(snapshot());
    const title = container.querySelector<HTMLElement>('[data-element-id="title"]')!;
    Object.defineProperties(title, {
      scrollWidth: { value: 650 }, clientWidth: { value: 600 },
      scrollHeight: { value: 120 }, clientHeight: { value: 120 }
    });
    Object.defineProperty(container.querySelector("[data-deks-stage]"), "getBoundingClientRect", {
      value: () => ({ left: 10, top: 20, width: 960, height: 540, right: 970, bottom: 560 })
    });
    const range = document.createRange();
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({ left: 110, top: 70, width: 300, height: 60, right: 410, bottom: 130 })
    });
    vi.spyOn(document, "createRange").mockReturnValue(range);

    expect(renderer.measureLayout()).toContainEqual(expect.objectContaining({
      elementId: "title",
      rect: { x: 100, y: 80, width: 600, height: 120 },
      contentRect: { x: 200, y: 100, width: 600, height: 120 },
      overflowStatus: "overflow",
      sources: { rect: "exact", visualAabb: "calculated", contentRect: "dom" }
    }));
    expect(renderer.measureLayout()).toContainEqual(expect.objectContaining({
      elementId: "photo",
      visualAabb: expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) })
    }));
    renderer.destroy();
    expect(container.childElementCount).toBe(0);
  });

  it("keeps a remote reload authoritative when it cancels an active transition", async () => {
    const pending: PendingAnimation[] = [];
    Element.prototype.animate = vi.fn(() => {
      const animation = new PendingAnimation();
      pending.push(animation);
      return animation as unknown as Animation;
    });
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const from = snapshot();
    const target: SlideSnapshot = { ...from, id: "old-target", elements: [] };
    const remote: SlideSnapshot = {
      ...from,
      id: "remote-revision",
      elements: [{ ...from.elements[0]!, content: "Versión remota" }]
    };

    renderer.compileTransition(from, target, timing(800));
    const playback = renderer.play();
    renderer.renderSlide(remote);

    await expect(playback).resolves.toBeUndefined();
    expect(pending.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
    expect(container.querySelector('[data-element-id="title"]')?.textContent).toBe("Versión remota");
  });

  it("rolls back partial WAAPI setup when the browser rejects an animation", () => {
    let calls = 0;
    const created: FakeAnimation[] = [];
    Element.prototype.animate = vi.fn(() => {
      calls += 1;
      if (calls === 2) throw new DOMException("Unsupported keyframe", "NotSupportedError");
      const animation = new FakeAnimation();
      created.push(animation);
      return animation as unknown as Animation;
    });
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const from = snapshot();
    const to: SlideSnapshot = { ...from, id: "slide-b" };

    expect(() => renderer.compileTransition(from, to, timing(800))).toThrow("Unsupported keyframe");
    expect(created[0]?.cancel).toHaveBeenCalledOnce();
    expect(() => renderer.seek(10)).toThrow("compileTransition must be called");
    expect(container.querySelectorAll("[data-element-id]")).toHaveLength(from.elements.length);
  });

  it("surfaces an unexpected WAAPI playback failure and clears the failed transition", async () => {
    const failure = new DOMException("Timeline failed", "InvalidStateError");
    const failed: FakeAnimation[] = [];
    Element.prototype.animate = vi.fn(() => {
      const animation = new FakeAnimation();
      animation.finished = Promise.reject(failure);
      failed.push(animation);
      return animation as unknown as Animation;
    });
    const renderer = new RendererCore();
    renderer.mount(document.createElement("div"));
    const from = snapshot();
    const to: SlideSnapshot = { ...from, id: "slide-b", elements: [] };

    renderer.compileTransition(from, to, timing(800));

    await expect(renderer.play()).rejects.toBe(failure);
    expect(failed.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
    expect(() => renderer.seek(10)).toThrow("compileTransition must be called");
  });

  it("honors reduced-motion without changing the persisted transition contract", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true }))
    });
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const from = snapshot();
    const to: SlideSnapshot = { ...from, id: "slide-b", elements: [] };

    const compiled = renderer.compileTransition(from, to, timing(800, 200, "ease-in-out"));
    const animationTiming = vi.mocked(Element.prototype.animate).mock.calls[0]?.[1] as KeyframeAnimationOptions;
    await renderer.play();

    expect(compiled).toEqual(expect.objectContaining({ durationMs: 800, delayMs: 200, totalDurationMs: 1000 }));
    expect(animationTiming.duration).toBe(0);
    expect(animationTiming.delay).toBe(0);
    expect(container.querySelectorAll("[data-element-id]")).toHaveLength(0);
  });

  it("renders discrete content changes as one accessible crossfade and scrubs both layers", () => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const from = snapshot();
    const to: SlideSnapshot = {
      ...from,
      id: "slide-b",
      elements: from.elements.map((element) => element.id === "title"
        ? { ...element, content: "Contenido nuevo", fontFamily: "Roboto" }
        : element)
    };

    renderer.compileTransition(from, to, timing(800, 100));
    renderer.seek(450);

    const layers = container.querySelectorAll('[data-transition-element-id="title"]');
    expect(layers).toHaveLength(2);
    expect(layers[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(layers[1]?.textContent).toBe("Contenido nuevo");
    expect(animations.filter((animation) => animation.currentTime === 450)).toHaveLength(4);
  });

  it("renders images as fixed absolute divs with background fit", () => {
    const renderer = new RendererCore();
    const container = document.createElement("div");
    renderer.mount(container);
    renderer.renderSlide(snapshot());

    const wrapper = container.querySelector<HTMLElement>('[data-element-id="photo"]')!;
    const content = wrapper.querySelector<HTMLElement>("[data-element-content]")!;
    expect(wrapper.tagName).toBe("DIV");
    expect(content.tagName).toBe("DIV");
    expect(content.style.backgroundImage).toContain("/assets/photo");
    expect(content.style.backgroundSize).toBe("cover");
    expect(content.style.backgroundPosition).toBe("center");
    expect(content.style.backgroundRepeat).toBe("no-repeat");
    expect(content.getAttribute("role")).toBe("img");
    expect(content.getAttribute("aria-label")).toBe("Demo");
  });

  it("interpolates text rect, font metrics, and color without transform scale", () => {
    const renderer = new RendererCore();
    renderer.mount(document.createElement("div"));
    const from = snapshot();
    const to: SlideSnapshot = {
      ...from,
      id: "slide-b",
      elements: from.elements.map((element) => element.id === "title" ? {
        ...element,
        rect: { x: 300, y: 180, width: 900, height: 240 },
        rotationDeg: 12,
        opacity: 0.7,
        fontSize: 88,
        fontWeight: 800,
        lineHeight: 1.4,
        letterSpacing: 3,
        color: "#ff0088"
      } : element)
    };

    renderer.compileTransition(from, to, timing(800));
    const titleCall = vi.mocked(Element.prototype.animate).mock.calls.find(([keyframes]) =>
      Array.isArray(keyframes) && keyframes[1]?.width === "900px"
    );
    expect(titleCall?.[0]).toEqual([
      expect.objectContaining({ left: "100px", width: "600px", fontSize: "64px", color: "#fff" }),
      expect.objectContaining({ left: "300px", width: "900px", fontSize: "88px", color: "#ff0088" })
    ]);
    expect(JSON.stringify(titleCall?.[0])).not.toContain("scale(");
  });

  it("renders typed solid and linear-gradient slide backgrounds exactly", () => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    renderer.renderSlide({
      ...snapshot(),
      background: { kind: "linear-gradient", angleDeg: 135, startColor: "#112233", endColor: "#ffeeaa" }
    });
    const background = container.querySelector<HTMLElement>("[data-deks-background]")!;
    expect(background.style.backgroundImage).toBe("linear-gradient(135deg, #112233, #ffeeaa)");
    expect(background.style.position).toBe("absolute");
    expect(background.style.inset).toBe("0");

    renderer.renderSlide({ ...snapshot(), background: { kind: "solid", color: "#abcdef" } });
    expect(container.querySelector<HTMLElement>("[data-deks-background]")?.style.backgroundColor).toBe("rgb(171, 205, 239)");
  });

  it("renders and compiles a 200-element slide within the renderer budget", () => {
    const elements = Array.from({ length: 200 }, (_, index) => ({
      ...snapshot().elements[1]!,
      id: `shape-${index}`,
      rect: { x: (index % 20) * 90, y: Math.floor(index / 20) * 90, width: 80, height: 80 },
      zIndex: index
    }));
    const from: SlideSnapshot = { id: "large-a", canvas: { width: 1920, height: 1080 }, elements };
    const to: SlideSnapshot = {
      ...from,
      id: "large-b",
      elements: elements.map((element) => ({ ...element, rect: { ...element.rect, x: element.rect.x + 10 } }))
    };
    const renderer = new RendererCore();
    renderer.mount(document.createElement("div"));
    const started = performance.now();

    renderer.renderSlide(from);
    renderer.compileTransition(from, to, timing(500));

    expect(performance.now() - started).toBeLessThan(500);
    expect(animations).toHaveLength(200);
  });

  it("previews one of 200 elements in place within a frame budget and restores its canonical frame", () => {
    const elements = Array.from({ length: 200 }, (_, index) => ({
      ...snapshot().elements[1]!,
      id: `shape-${index}`,
      rect: { x: (index % 20) * 90, y: Math.floor(index / 20) * 90, width: 80, height: 80 },
      zIndex: index
    }));
    const canonical: SlideSnapshot = {
      id: "large-preview",
      canvas: { width: 1920, height: 1080 },
      elements
    };
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    renderer.renderSlide(canonical);
    const stage = container.querySelector<HTMLElement>("[data-deks-stage]")!;
    const target = stage.querySelector<HTMLElement>('[data-element-id="shape-137"]')!;
    const untouched = stage.querySelector<HTMLElement>('[data-element-id="shape-138"]')!;
    const replaceChildren = vi.spyOn(stage, "replaceChildren");
    const started = performance.now();

    for (let frame = 0; frame < 100; frame += 1) {
      expect(renderer.previewElement({
        ...elements[137]!,
        rect: { x: 700 + frame, y: 410, width: 160, height: 100 },
        rotationDeg: 12,
        opacity: 0.4
      })).toBe(true);
    }
    const elapsedPerPreview = (performance.now() - started) / 100;

    expect(elapsedPerPreview).toBeLessThan(16);
    expect(replaceChildren).not.toHaveBeenCalled();
    expect(stage.querySelector('[data-element-id="shape-137"]')).toBe(target);
    expect(stage.querySelector('[data-element-id="shape-138"]')).toBe(untouched);
    expect(target.style.left).toBe("799px");
    expect(target.style.top).toBe("410px");
    expect(target.style.width).toBe("160px");
    expect(target.style.height).toBe("100px");
    expect(target.style.transform).toBe("rotate(12deg)");
    expect(target.style.opacity).toBe("0.4");
    expect(target.style.getPropertyValue("--deks-x")).toBe("799px");
    expect(target.style.getPropertyValue("--deks-rotation")).toBe("12deg");
    expect(renderer.measureLayout().find(({ elementId }) => elementId === "shape-137")?.rect)
      .toEqual(elements[137]!.rect);

    expect(renderer.restoreElement("shape-137")).toBe(true);
    expect(target.style.left).toBe(`${elements[137]!.rect.x}px`);
    expect(target.style.top).toBe(`${elements[137]!.rect.y}px`);
    expect(target.style.width).toBe("80px");
    expect(target.style.height).toBe("80px");
    expect(target.style.transform).toBe("rotate(0deg)");
    expect(target.style.opacity).toBe("0.8");
    const restoredStyle = target.getAttribute("style");
    expect(() => renderer.previewElement({ ...elements[137]!, opacity: 2 }))
      .toThrow("opacity must be between 0 and 1");
    expect(target.getAttribute("style")).toBe(restoredStyle);
    expect(renderer.previewElement({ ...elements[137]!, id: "removed-remotely" })).toBe(false);
    expect(renderer.restoreElement("removed-remotely")).toBe(false);
  });

  it("switches between clipped presentation and visible editor viewport modes", () => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    renderer.renderSlide(snapshot());
    const stage = container.querySelector<HTMLElement>("[data-deks-stage]")!;

    expect(stage.style.overflow).toBe("hidden");
    renderer.setViewportMode("editor");
    expect(stage.style.overflow).toBe("visible");
    renderer.setViewportMode("presentation");
    expect(stage.style.overflow).toBe("hidden");
  });

  it("renders a faithful non-interactive onion snapshot behind the canonical scene", () => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    renderer.renderSlide(snapshot());
    const previous: SlideSnapshot = {
      ...snapshot(),
      id: "previous",
      background: { kind: "solid", color: "#ff0088" },
      elements: snapshot().elements.map((element) => element.id === "title"
        ? { ...element, content: "Antes", rect: { ...element.rect, x: -80 } }
        : element)
    };

    renderer.setOnionSkin(previous, { opacity: 0.28 });

    const layer = container.querySelector<HTMLElement>("[data-deks-onion]")!;
    const onionTitle = layer.querySelector<HTMLElement>('[data-onion-element-id="title"]')!;
    const activeTitle = container.querySelector<HTMLElement>('[data-element-id="title"]')!;
    expect(layer.style.opacity).toBe("0.28");
    expect(layer.style.pointerEvents).toBe("none");
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(onionTitle.textContent).toBe("Antes");
    expect(onionTitle.style.left).toBe("-80px");
    expect(onionTitle).not.toBe(activeTitle);
    expect(layer.querySelector<HTMLElement>("[data-deks-background]")?.style.backgroundColor)
      .toBe("rgb(255, 0, 136)");

    renderer.setOnionSkin(null);
    expect(container.querySelector("[data-deks-onion]")).toBeNull();
    expect(container.querySelector('[data-element-id="title"]')).toBe(activeTitle);
  });

  it("selects and previews multiple elements atomically, then rolls them back without a full render", () => {
    const container = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(container);
    const canonical = snapshot();
    renderer.renderSlide(canonical);
    const title = container.querySelector<HTMLElement>('[data-element-id="title"]')!;
    const box = container.querySelector<HTMLElement>('[data-element-id="box"]')!;
    const replaceChildren = vi.spyOn(container.querySelector<HTMLElement>("[data-deks-stage]")!, "replaceChildren");

    expect(renderer.setSelection(["title", "box"])).toBe(true);
    expect(title.dataset.deksSelected).toBe("");
    expect(box.dataset.deksSelected).toBe("");
    expect(renderer.setSelection(["title", "missing"])).toBe(false);
    expect(title.dataset.deksSelected).toBe("");
    expect(box.dataset.deksSelected).toBe("");

    expect(renderer.previewElements([
      { ...canonical.elements[0]!, rect: { x: 300, y: 200, width: 500, height: 100 } },
      { ...canonical.elements[1]!, rect: { x: 250, y: 240, width: 900, height: 360 } }
    ])).toBe(true);
    expect(title.style.left).toBe("300px");
    expect(box.style.left).toBe("250px");
    expect(renderer.previewElements([
      { ...canonical.elements[0]!, rect: { x: 999, y: 200, width: 500, height: 100 } },
      { ...canonical.elements[1]!, id: "missing" }
    ])).toBe(false);
    expect(title.style.left).toBe("300px");
    expect(box.style.left).toBe("250px");

    expect(renderer.restoreElements(["title", "box"])).toBe(true);
    expect(title.style.left).toBe("100px");
    expect(box.style.left).toBe("50px");
    expect(replaceChildren).not.toHaveBeenCalled();
  });
});
