import { describe, expect, it, vi } from "vitest";
import { PreviewRenderer } from "../src";
import { workerLayoutMeasurements } from "../src/protocol";

const document = {
  format: "deks",
  codecVersion: 2,
  id: "deck",
  name: "Preview",
  canvas: { width: 1920, height: 1080 },
  motionBeatMs: 600,
  motion: {
    in: { animation: { kind: "fade" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-out" },
    out: { animation: { kind: "fade" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-in" },
    morph: { animation: { kind: "morph" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-in-out" },
  },
  revision: 4,
  palette: {
    primary: "#ff7043", secondary: "#2dd4bf", accent: "#60a5fa",
    background: "#090d16", text: "#f4f7fb", subtext: "#94a0b4",
  },
  history: { canUndo: false, canRedo: false },
  assets: [],
  elements: [],
  slides: [{
    id: "slide", name: "Slide", isTemplate: false,
    background: { kind: "solid", color: "#090d16" },
    states: [],
  }],
};

describe("headless preview renderer contract", () => {
  it("keeps one browser alive while isolating and closing every preview context", async () => {
    const png = Buffer.from("png-bytes");
    const screenshot = vi.fn(async () => png);
    const measurements = [{
      elementId: "headline",
      rect: { x: 100, y: 120, width: 600, height: 80 },
      visualAabb: { x: 100, y: 120, width: 600, height: 80 },
      contentRect: { x: 100, y: 120, width: 640, height: 96 },
      overflowStatus: "overflow" as const,
      sources: { rect: "exact" as const, visualAabb: "calculated" as const, contentRect: "dom" as const },
    }];
    const evaluate = vi.fn(async () => measurements);
    const route = vi.fn(async (_pattern, handler) => {
      const abort = vi.fn();
      await handler({ abort });
      expect(abort).toHaveBeenCalledWith("blockedbyclient");
    });
    const contextClose = vi.fn(async () => undefined);
    const page = {
      setContent: vi.fn(async () => undefined),
      addStyleTag: vi.fn(async () => undefined),
      addScriptTag: vi.fn(async () => undefined),
      evaluate,
      locator: vi.fn(() => ({ screenshot })),
    };
    const context = { route, newPage: vi.fn(async () => page), close: contextClose };
    const browserClose = vi.fn(async () => undefined);
    const browser = { newContext: vi.fn(async () => context), close: browserClose };
    const launch = vi.fn(async () => browser);
    const renderer = new PreviewRenderer({
      launch,
      browserBundle: "globalThis.DeksPreviewBrowser={mount(){}}",
      fontCss: "@font-face{}",
    });

    const first = await renderer.render({ document, slideId: "slide", width: 1600, assets: {} });
    const second = await renderer.render({ document, slideId: "slide", width: 1280, assets: {} });
    await renderer.close();

    expect(first).toEqual({ png, width: 1600, height: 900, measurements });
    expect(second).toEqual({ png, width: 1280, height: 720, measurements });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(browser.newContext).toHaveBeenCalledTimes(2);
    expect(route).toHaveBeenCalledWith("**/*", expect.any(Function));
    expect(contextClose).toHaveBeenCalledTimes(2);
    expect(browserClose).toHaveBeenCalledTimes(1);
    expect(page.locator).toHaveBeenCalledWith("[data-deks-stage]");
    expect(screenshot).toHaveBeenCalledWith({ animations: "disabled", type: "png" });
  });

  it("normalizes safe SVG before crossing into Chromium", async () => {
    const evaluate = vi.fn(async () => []);
    const page = {
      setContent: vi.fn(async () => undefined),
      addStyleTag: vi.fn(async () => undefined),
      addScriptTag: vi.fn(async () => undefined),
      evaluate,
      locator: vi.fn(() => ({ screenshot: vi.fn(async () => Buffer.from("png")) })),
    };
    const context = {
      route: vi.fn(async () => undefined),
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };
    const renderer = new PreviewRenderer({
      launch: vi.fn(async () => ({ newContext: vi.fn(async () => context), close: vi.fn(async () => undefined) })),
      browserBundle: "",
      fontCss: "",
    });
    const source = '<svg height="50" width="100" xmlns="http://www.w3.org/2000/svg"><rect fill="#fff" height="50" width="100"/></svg>';

    await renderer.render({
      document,
      slideId: "slide",
      width: 1600,
      assets: { asset: { mediaType: "image/svg+xml", base64: Buffer.from(source).toString("base64") } },
    });

    const browserInput = evaluate.mock.calls[0]![1];
    expect(Buffer.from(browserInput.assets.asset.base64, "base64").toString("utf8")).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect fill="#fff" height="50" width="100"/></svg>',
    );
  });

  it("rejects absent slides and malicious SVG before launching Chromium", async () => {
    const launch = vi.fn();
    const renderer = new PreviewRenderer({
      launch,
      browserBundle: "",
      fontCss: "",
    });

    await expect(renderer.render({ document, slideId: "missing", width: 1600, assets: {} }))
      .rejects.toThrow(/slide/i);
    await expect(renderer.render({
      document,
      slideId: "slide",
      width: 1600,
      assets: {
        asset: {
          mediaType: "image/svg+xml",
          base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>').toString("base64"),
        },
      },
    })).rejects.toThrow(/SVG|script|unsupported/i);
    expect(launch).not.toHaveBeenCalled();
  });

  it("serializes every portable measurement to the stable worker boundary", () => {
    expect(workerLayoutMeasurements([{
      elementId: "headline",
      rect: { x: 100, y: 120, width: 600, height: 80 },
      visualAabb: { x: 100, y: 120, width: 600, height: 80 },
      contentRect: { x: 100, y: 120, width: 640, height: 96 },
      overflowStatus: "overflow",
      sources: { rect: "exact", visualAabb: "calculated", contentRect: "dom" },
    }, {
      elementId: "frame",
      rect: { x: 80, y: 90, width: 700, height: 200 },
      visualAabb: { x: 80, y: 90, width: 700, height: 200 },
      sources: { rect: "exact", visualAabb: "calculated" },
    }])).toEqual([{
      element_id: "headline",
      rect: { x: 100, y: 120, width: 600, height: 80 },
      visual_aabb: { x: 100, y: 120, width: 600, height: 80 },
      content_rect: { x: 100, y: 120, width: 640, height: 96 },
      overflow_status: "overflow",
      measurement_source: "dom",
    }, {
      element_id: "frame",
      rect: { x: 80, y: 90, width: 700, height: 200 },
      visual_aabb: { x: 80, y: 90, width: 700, height: 200 },
      measurement_source: "dom",
    }]);
  });
});
