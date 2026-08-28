import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PreviewRenderer } from "../src";

const document = {
  format: "deks",
  codecVersion: 2,
  id: "browser-deck",
  name: "Browser preview",
  canvas: { width: 1920, height: 1080 },
  motionBeatMs: 600,
  motion: {
    in: { animation: { kind: "fade" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-out" },
    out: { animation: { kind: "fade" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-in" },
    morph: { animation: { kind: "morph" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-in-out" },
  },
  revision: 1,
  palette: {
    primary: "#ff7043", secondary: "#2dd4bf", accent: "#60a5fa",
    background: "#090d16", text: "#f4f7fb", subtext: "#94a0b4",
  },
  history: { canUndo: false, canRedo: false },
  assets: [],
  elements: [{
    id: "headline", kind: "text", name: "Headline", isLocked: false, semanticRole: "title",
    content: "Govern AI through better paths without clipping the evidence that supports the decision",
    fontFamily: "Poppins", horizontalAlignment: "left", verticalAlignment: "top", overflowMode: "hidden",
  }],
  slides: [{
    id: "slide", name: "Slide", isTemplate: false,
    background: {
      kind: "linear-gradient", startColor: "#090d16", endColor: "#18243c", angleDeg: 90,
    },
    states: [{
      elementId: "headline", x: 120, y: 120, width: 500, height: 40,
      rotationDeg: 0, opacity: 1, zIndex: 1,
      fontSize: 72, fontWeight: 700,
      lineHeight: 1.1, letterSpacing: 0,
      fill: "#f4f7fb",
    }],
  }],
};

describe("real Chromium preview", () => {
  it("renders the canonical stage to an exact-size PNG without network", async () => {
    const bundle = await readFile(new URL("../dist/browser-entry.js", import.meta.url), "utf8");
    const renderer = new PreviewRenderer({ browserBundle: bundle });
    try {
      const result = await renderer.render({ document, slideId: "slide", width: 1280, assets: {} });
      expect(result.width).toBe(1280);
      expect(result.height).toBe(720);
      expect(result.png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(result.png.readUInt32BE(16)).toBe(1280);
      expect(result.png.readUInt32BE(20)).toBe(720);
      expect(result.png.byteLength).toBeGreaterThan(10_000);
      expect(result.measurements).toEqual([
        expect.objectContaining({
          elementId: "headline",
          rect: { x: 120, y: 120, width: 500, height: 40 },
          overflowStatus: "overflow",
          sources: expect.objectContaining({ contentRect: "dom" }),
        }),
      ]);
      expect(result.measurements[0]?.contentRect?.width).toBeGreaterThan(0);
      expect(result.measurements[0]?.contentRect?.height).toBeGreaterThan(40);
    } finally {
      await renderer.close();
    }
  });

  it("renders a normalized safe SVG while the network remains blocked", async () => {
    const bundle = await readFile(new URL("../dist/browser-entry.js", import.meta.url), "utf8");
    const renderer = new PreviewRenderer({ browserBundle: bundle });
    const svgDocument = structuredClone(document);
    svgDocument.assets = [{ id: "asset", kind: "embedded", mediaType: "image/svg+xml", originalFilename: "shape.svg" }];
    svgDocument.elements = [{ id: "image", kind: "image", name: "Vector", isLocked: false }];
    svgDocument.slides[0]!.states = [{
      elementId: "image", x: 100, y: 80, width: 400, height: 200,
      rotationDeg: 0, opacity: 1, zIndex: 1,
      assetId: "asset", alt: "Safe vector", fit: "contain",
    }];
    const svg = '<svg height="50" width="100" xmlns="http://www.w3.org/2000/svg"><rect fill="#ff7043" height="50" width="100"/></svg>';
    try {
      const result = await renderer.render({
        document: svgDocument,
        slideId: "slide",
        width: 1280,
        assets: { asset: { mediaType: "image/svg+xml", base64: Buffer.from(svg).toString("base64") } },
      });
      expect(result.png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(result.measurements).toEqual([
        expect.objectContaining({
          elementId: "image",
          rect: { x: 100, y: 80, width: 400, height: 200 },
        }),
      ]);
    } finally {
      await renderer.close();
    }
  });
});
