import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PreviewRenderer } from "../src";

const document = {
  format: "deks",
  id: "browser-deck",
  name: "Browser preview",
  canvas: { width: 1920, height: 1080 },
  motionBeatMs: 600,
  revision: 1,
  palette: {
    primary: "#ff7043", secondary: "#2dd4bf", accent: "#60a5fa",
    background: "#090d16", text: "#f4f7fb", subtext: "#94a0b4",
  },
  history: { canUndo: false, canRedo: false },
  assets: [],
  elements: [{ id: "headline", kind: "text", name: "Headline", isLocked: false, semanticRole: "title" }],
  slides: [{
    id: "slide", name: "Slide", isTemplate: false,
    background: {
      kind: "linear-gradient", startColor: "#090d16", endColor: "#18243c", angleDeg: 90,
    },
    inPreset: "fade", outPreset: "fade", inDurationMultiplier: 1, outDurationMultiplier: 1,
    states: [{
      elementId: "headline", x: 120, y: 120, width: 500, height: 40,
      rotationDeg: 0, opacity: 1, zIndex: 1,
      content: "Govern AI through better paths without clipping the evidence that supports the decision",
      fontFamily: "Poppins", fontSize: 72, fontWeight: 700,
      lineHeight: 1.1, letterSpacing: 0,
      horizontalAlignment: "left", verticalAlignment: "top", overflowMode: "hidden",
      fill: "#f4f7fb",
    }],
  }],
  transitions: [],
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
});
