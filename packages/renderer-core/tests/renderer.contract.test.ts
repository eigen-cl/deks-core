import { describe, expect, it, vi } from "vitest";
import { RendererCore, toSlideSnapshot } from "../src";
import type { Slide, SlideBackground, SlideTransition } from "@deks-js/document";

const slide: Slide = {
  id: "slide",
  name: "Intro",
  isTemplate: false,
  background: { kind: "solid", color: "#0b0c0e" },
  inPreset: "fade",
  outPreset: "fade",
  inDurationMultiplier: 1,
  outDurationMultiplier: 1,
  elements: [
    {
      id: "cta",
      kind: "link-button",
      name: "CTA",
      x: 20,
      y: 30,
      width: 300,
      height: 90,
      rotationDeg: 0,
      opacity: 1,
      zIndex: 1,
      label: "Entrar",
      url: "https://app.deks.eigen.cl/",
      fill: "#ff7043",
      textColor: "#0b0c0e",
    },
  ],
};

describe("imperative renderer contract", () => {
  it("renders absolute semantic elements and delegates links only in presentation mode", () => {
    const host = document.createElement("div");
    const open = vi.fn();
    const renderer = new RendererCore({ onOpenExternal: open });
    renderer.mount(host);
    renderer.renderSlide(toSlideSnapshot(slide, { width: 1920, height: 1080 }));

    const link = host.querySelector<HTMLButtonElement>("[data-element-id=cta]")!;
    expect(link).toHaveTextContent("Entrar");
    expect(link.style.position).toBe("absolute");
    link.click();
    expect(open).not.toHaveBeenCalled();

    renderer.setViewportMode("presentation");
    link.click();
    expect(open).toHaveBeenCalledWith("https://app.deks.eigen.cl/");
  });

  it("resolves assets through the host instead of fetching", () => {
    const host = document.createElement("div");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const renderer = new RendererCore({ assetResolver: ({ assetId }) => assetId === "hero" ? "blob:hero" : undefined });
    renderer.mount(host);
    renderer.renderSlide(toSlideSnapshot({ ...slide, elements: [{
      id: "image", kind: "image", name: "Hero", x: 0, y: 0, width: 100, height: 100,
      rotationDeg: 0, opacity: 1, zIndex: 1, assetId: "hero", alt: "Hero", fit: "cover",
    }] }, { width: 1920, height: 1080 }));
    expect(host.querySelector("img")).toHaveAttribute("src", "blob:hero");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders a catalog-backed icon as safe inline SVG without fetching", () => {
    const host = document.createElement("div");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const renderer = new RendererCore();
    renderer.mount(host);
    renderer.renderSlide(toSlideSnapshot({ ...slide, elements: [{
      id: "governance", kind: "icon", name: "Governance", x: 50, y: 50, width: 120, height: 120,
      rotationDeg: 0, opacity: 1, zIndex: 1, iconFamily: "lucide", iconName: "shield-check",
      fill: "#5EEAD4", strokeWidth: 2,
    }] }, { width: 1920, height: 1080 }));
    const svg = host.querySelector<SVGSVGElement>("[data-element-id=governance] svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.parentElement).toHaveStyle({ color: "rgb(94, 234, 212)" });
    expect(svg.querySelectorAll("path")).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports canonical geometry and browser-measured text overflow", () => {
    const host = document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(host);
    renderer.renderSlide(toSlideSnapshot({ ...slide, elements: [
      {
        id: "headline", kind: "text", name: "Headline", x: 100, y: 200, width: 300, height: 100,
        rotationDeg: 90, opacity: 1, zIndex: 1, content: "A headline that does not fit",
        fontFamily: "Poppins", fontSize: 48, fontWeight: 700, lineHeight: 1.1,
        letterSpacing: 0, horizontalAlignment: "left", verticalAlignment: "top",
        overflowMode: "hidden", fill: "#ffffff",
      },
      {
        id: "frame", kind: "shape", shapeKind: "rectangle", name: "Frame",
        x: 500, y: 100, width: 400, height: 240, rotationDeg: 0, opacity: 1, zIndex: 0,
        fill: "#0b0c0e",
      },
    ] }, { width: 1920, height: 1080 }));

    const stage = host.querySelector<HTMLElement>("[data-deks-stage]")!;
    const headline = host.querySelector<HTMLElement>("[data-element-id=headline]")!;
    expect(headline.style.whiteSpace).toBe("pre-wrap");
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
      x: 10, y: 20, left: 10, top: 20, right: 970, bottom: 560,
      width: 960, height: 540, toJSON: () => ({}),
    });
    Object.defineProperties(headline, {
      clientWidth: { configurable: true, value: 150 },
      clientHeight: { configurable: true, value: 50 },
      scrollWidth: { configurable: true, value: 260 },
      scrollHeight: { configurable: true, value: 80 },
    });
    const range = {
      selectNodeContents: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({
        x: 60, y: 70, left: 60, top: 70, right: 260, bottom: 110,
        width: 200, height: 40, toJSON: () => ({}),
      })),
    };
    vi.spyOn(document, "createRange").mockReturnValue(range as unknown as Range);

    expect(renderer.measureLayout()).toEqual([
      {
        elementId: "headline",
        rect: { x: 100, y: 200, width: 300, height: 100 },
        visualAabb: { x: 0, y: 200, width: 100.00000000000001, height: 300 },
        contentRect: { x: 100, y: 100, width: 400, height: 80 },
        overflowStatus: "overflow",
        sources: { rect: "exact", visualAabb: "calculated", contentRect: "dom" },
      },
      {
        elementId: "frame",
        rect: { x: 500, y: 100, width: 400, height: 240 },
        visualAabb: { x: 500, y: 100, width: 400, height: 240 },
        sources: { rect: "exact", visualAabb: "calculated" },
      },
    ]);
    expect(range.selectNodeContents).toHaveBeenCalledWith(headline);
  });
});

const transition: SlideTransition = {
  fromSlideId: "from",
  toSlideId: "to",
  motionBeatMs: 480,
  durationMultiplier: 1.5,
  effectiveDurationMs: 720,
  delayMs: 80,
  easing: "ease-in-out",
};

const backgroundCases: [string, SlideBackground, SlideBackground][] = [
  ["solid to solid", { kind: "solid", color: "#0b0c0e" }, { kind: "solid", color: "#ff7043" }],
  ["solid to gradient", { kind: "solid", color: "#0b0c0e" }, { kind: "linear-gradient", startColor: "#ff7043", endColor: "#73a7ff", angleDeg: 90 }],
  ["gradient to solid", { kind: "linear-gradient", startColor: "#65c18c", endColor: "#73a7ff", angleDeg: 45 }, { kind: "solid", color: "#0b0c0e" }],
  ["gradient to gradient", { kind: "linear-gradient", startColor: "#0b0c0e", endColor: "#65c18c", angleDeg: 0 }, { kind: "linear-gradient", startColor: "#ff7043", endColor: "#73a7ff", angleDeg: 135 }],
];

function snapshot(id: string, background: SlideBackground) {
  return { id, canvas: { width: 1920, height: 1080 }, background, elements: [] };
}

function painted(background: SlideBackground): string {
  const value = background.kind === "solid"
    ? background.color
    : `linear-gradient(${background.angleDeg}deg, ${background.startColor}, ${background.endColor})`;
  const probe = document.createElement("div");
  probe.style.background = value;
  return probe.style.background;
}

describe("background transition storytelling contract", () => {
  it.each(backgroundCases)("interpolates %s with the transition beat and duration", async (_name, from, to) => {
    const host = document.createElement("div");
    const completions: (() => void)[] = [];
    const animate = vi.fn(function (this: HTMLElement) {
      return {
        finished: new Promise<void>((resolve) => completions.push(resolve)),
        cancel: vi.fn(),
        pause: vi.fn(),
      } as unknown as Animation;
    });
    const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
    const requestAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);

    try {
      const renderer = new RendererCore();
      renderer.mount(host);
      renderer.compileTransition(snapshot("from", from), snapshot("to", to), transition);

      const playback = renderer.play();
      const current = host.querySelector<HTMLElement>("[data-deks-background=current]")!;
      const outgoing = host.querySelector<HTMLElement>("[data-deks-background=outgoing]")!;

      expect(current.style.background).toBe(painted(to));
      expect(outgoing.style.background).toBe(painted(from));
      expect(animate).toHaveBeenCalledTimes(1);
      expect(animate).toHaveBeenNthCalledWith(
        1,
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 720, delay: 80, easing: "ease-in-out", fill: "both" },
      );
      expect(requestAnimationFrame).not.toHaveBeenCalled();

      completions.forEach((complete) => complete());
      await playback;
      expect(host.querySelector("[data-deks-background=outgoing]")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
      if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
      else Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
  });

  it("cuts directly to the destination background when reduced motion is preferred", async () => {
    const host = document.createElement("div");
    const animate = vi.fn();
    const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));

    try {
      const renderer = new RendererCore();
      renderer.mount(host);
      const from = backgroundCases[1]![1];
      const to = backgroundCases[1]![2];
      renderer.compileTransition(snapshot("from", from), snapshot("to", to), transition);
      await renderer.play();

      expect(host.querySelector<HTMLElement>("[data-deks-background=current]")!.style.background).toBe(painted(to));
      expect(host.querySelector("[data-deks-background=outgoing]")).not.toBeInTheDocument();
      expect(animate).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
      else Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
  });
});
