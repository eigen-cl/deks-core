import { describe, expect, it, vi } from "vitest";
import type { DeksDocument, DeksElement, DeksElementState } from "@deks-js/document";
import { RendererCore, toSlideSnapshot } from "../src";

const common = (elementId: string, patch: Partial<DeksElementState> = {}): DeksElementState => ({
  elementId, x: 20, y: 30, width: 300, height: 90,
  rotationDeg: 0, opacity: 1, zIndex: 1, ...patch,
});

function canonical(elements: DeksElement[], states: DeksElementState[]): DeksDocument {
  return {
    format: "deks", id: "renderer", name: "Renderer", revision: 0,
    canvas: { width: 1920, height: 1080 }, motionBeatMs: 600,
    palette: { primary: "#ff7043", secondary: "#65c18c", accent: "#73a7ff", background: "#0b0c0e", text: "#f2f1ec", subtext: "#969da6" },
    history: { canUndo: false, canRedo: false }, assets: [], elements,
    slides: [{
      id: "slide", name: "Intro", isTemplate: false,
      background: { kind: "solid", color: "#0b0c0e" }, inPreset: "fade", outPreset: "fade",
      inDurationMultiplier: 1, outDurationMultiplier: 1, states,
    }], transitions: [],
  };
}

describe("imperative renderer canonical document contract", () => {
  it("renders a canonical link and delegates activation only in presentation mode", () => {
    const document = canonical(
      [{ id: "cta", kind: "link-button", name: "CTA", isLocked: false }],
      [common("cta", {
        label: "Entrar", url: "https://app.deks.eigen.cl/", fill: "#ff7043", textColor: "#0b0c0e",
        fontFamily: "Poppins", fontSize: 32, fontWeight: 600, cornerRadius: 12, stroke: "#ff7043", strokeWidth: 0,
      })],
    );
    const host = globalThis.document.createElement("div");
    const open = vi.fn();
    const renderer = new RendererCore({ onOpenExternal: open });
    renderer.mount(host);
    renderer.renderSlide(document, "slide");
    const link = host.querySelector<HTMLButtonElement>("[data-element-id=cta]")!;
    link.click();
    expect(open).not.toHaveBeenCalled();
    renderer.setViewportMode("presentation");
    link.click();
    expect(open).toHaveBeenCalledWith("https://app.deks.eigen.cl/");
  });

  it("resolves a canonical asset exactly once without fetching", () => {
    const document = canonical(
      [{ id: "image", kind: "image", name: "Hero", isLocked: false }],
      [common("image", { assetId: "hero", alt: "Hero", fit: "cover" })],
    );
    document.assets = [{ id: "hero", kind: "embedded", mediaType: "image/png" }];
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const resolve = vi.fn(() => "blob:hero");
    const host = globalThis.document.createElement("div");
    const renderer = new RendererCore({ assetResolver: resolve });
    renderer.mount(host);
    renderer.renderSlide(document, "slide");
    expect(host.querySelector("img")).toHaveAttribute("src", "blob:hero");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not retry an unresolved canonical asset inside the DOM renderer", () => {
    const document = canonical(
      [{ id: "image", kind: "image", name: "Hero", isLocked: false }],
      [common("image", { assetId: "hero", alt: "Hero", fit: "cover" })],
    );
    document.assets = [{ id: "hero", kind: "embedded", mediaType: "image/png" }];
    const resolve = vi.fn(() => undefined);
    const host = globalThis.document.createElement("div");
    const renderer = new RendererCore({ assetResolver: resolve });
    renderer.mount(host);
    renderer.renderSlide(document, "slide");
    expect(host.querySelector("img")).not.toHaveAttribute("src");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("projects groups away and retains their canonical children", () => {
    const document = canonical(
      [
        { id: "cluster", kind: "group", name: "Cluster", isLocked: false },
        { id: "child", kind: "text", name: "Child", parentId: "cluster", isLocked: false },
      ],
      [
        common("cluster", { width: 500, height: 300 }),
        common("child", {
          content: "Visible", fontFamily: "Poppins", fontSize: 32, fontWeight: 400, lineHeight: 1.2,
          letterSpacing: 0, horizontalAlignment: "left", verticalAlignment: "top", overflowMode: "visible", fill: "#ffffff",
        }),
      ],
    );
    expect(toSlideSnapshot(document, "slide").elements.map(({ id }) => id)).toEqual(["child"]);
  });

  it("renders per-corner rectangle radii with no persisted uniform fallback", () => {
    const document = canonical(
      [{ id: "frame", kind: "shape", shapeKind: "rectangle", name: "Frame", isLocked: false }],
      [common("frame", {
        shapeFill: { kind: "solid", color: "#ff7043" }, stroke: "#ff7043", strokeWidth: 0,
        cornerRadii: { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 },
      })],
    );
    const host = globalThis.document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(host);
    renderer.renderSlide(document, "slide");
    expect(host.querySelector<HTMLElement>("[data-element-id=frame]")!.style.borderRadius).toBe("4px 8px 12px 16px");
  });

  it("reports renderer measurements separately from persisted document state", () => {
    const document = canonical(
      [{ id: "headline", kind: "text", name: "Headline", isLocked: false }],
      [common("headline", {
        x: 100, y: 200, width: 300, height: 100, rotationDeg: 90, content: "A headline",
        fontFamily: "Poppins", fontSize: 48, fontWeight: 700, lineHeight: 1.1, letterSpacing: 0,
        horizontalAlignment: "left", verticalAlignment: "top", overflowMode: "hidden", fill: "#ffffff",
      })],
    );
    const host = globalThis.document.createElement("div");
    const renderer = new RendererCore();
    renderer.mount(host);
    renderer.renderSlide(document, "slide");
    vi.spyOn(globalThis.document, "createRange").mockReturnValue({
      selectNodeContents: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0, width: 0, height: 0 })),
    } as unknown as Range);
    const measurement = renderer.measureLayout()[0]!;
    expect(measurement.rect).toEqual({ x: 100, y: 200, width: 300, height: 100 });
    expect(document.slides[0]!.states[0]).not.toHaveProperty("renderedTextBounds");
    expect(document.slides[0]!.states[0]).not.toHaveProperty("measurementSource");
  });

  it("derives forward and reverse playback from one canonical boundary", () => {
    const document = canonical([
      { id: "leaves", kind: "icon", name: "Leaves", isLocked: false },
      { id: "enters", kind: "icon", name: "Enters", isLocked: false },
    ], [common("leaves", { iconFamily: "lucide", iconName: "cloud", fill: "#ffffff", strokeWidth: 2 })]);
    document.slides.push({
      ...document.slides[0]!, id: "slide-2", name: "Second",
      states: [common("enters", { iconFamily: "lucide", iconName: "database", fill: "#ffffff", strokeWidth: 2 })],
    });
    document.transitions = [{
      fromSlideId: "slide", toSlideId: "slide-2", motionBeatMs: 600, durationMultiplier: 1,
      effectiveDurationMs: 600, delayMs: 0, easing: "ease-in-out",
      elementMotions: [
        { elementId: "leaves", direction: "out", preset: "glide-left", durationMultiplier: 1, delayMs: 0 },
        { elementId: "enters", direction: "in", preset: "glide-right", durationMultiplier: 1, delayMs: 0 },
      ],
    }];
    const renderer = new RendererCore();
    renderer.mount(globalThis.document.createElement("div"));
    const forward = renderer.compileTransition(document, "slide", "slide-2");
    const reverse = renderer.compileTransition(document, "slide-2", "slide");
    expect(forward.operations.map(({ elementId, type }) => [elementId, type])).toEqual([["leaves", "exit"], ["enters", "enter"]]);
    expect(reverse.operations.map(({ elementId, type }) => [elementId, type])).toEqual([["enters", "exit"], ["leaves", "enter"]]);
  });
});
