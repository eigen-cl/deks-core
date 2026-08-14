import { describe, expect, it, vi } from "vitest";
import { PreviewRenderer } from "../src";

const document = {
  id: "deck",
  name: "Preview",
  canvas_width: 1920,
  canvas_height: 1080,
  motion_beat_ms: 600,
  revision: 4,
  palette: {
    primary: "#ff7043", secondary: "#2dd4bf", accent: "#60a5fa",
    background: "#090d16", text: "#f4f7fb", subtext: "#94a0b4",
  },
  history: { can_undo: false, can_redo: false },
  slides: [{
    id: "slide", position: 0, name: "Slide", is_template: false,
    background: { kind: "solid", solid_color: "#090d16", gradient_start: null, gradient_end: null, angle_deg: null },
    animation: {
      in: { preset: "fade", duration_multiplier: 1, effective_duration_ms: 600 },
      out: { preset: "fade", duration_multiplier: 1, effective_duration_ms: 600 },
    },
    elements: [],
  }],
  transitions: [],
};

describe("headless preview renderer contract", () => {
  it("keeps one browser alive while isolating and closing every preview context", async () => {
    const png = Buffer.from("png-bytes");
    const screenshot = vi.fn(async () => png);
    const evaluate = vi.fn(async () => undefined);
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

    expect(first).toEqual({ png, width: 1600, height: 900 });
    expect(second).toEqual({ png, width: 1280, height: 720 });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(browser.newContext).toHaveBeenCalledTimes(2);
    expect(route).toHaveBeenCalledWith("**/*", expect.any(Function));
    expect(contextClose).toHaveBeenCalledTimes(2);
    expect(browserClose).toHaveBeenCalledTimes(1);
    expect(page.locator).toHaveBeenCalledWith("[data-deks-stage]");
    expect(screenshot).toHaveBeenCalledWith({ animations: "disabled", type: "png" });
  });

  it("rejects absent slides and assets that are not safe raster data", async () => {
    const renderer = new PreviewRenderer({
      launch: vi.fn(),
      browserBundle: "",
      fontCss: "",
    });

    await expect(renderer.render({ document, slideId: "missing", width: 1600, assets: {} }))
      .rejects.toThrow(/slide/i);
    await expect(renderer.render({
      document,
      slideId: "slide",
      width: 1600,
      assets: { asset: { mediaType: "image/svg+xml", base64: "PHN2Zz4=" } },
    })).rejects.toThrow(/media type/i);
  });
});
