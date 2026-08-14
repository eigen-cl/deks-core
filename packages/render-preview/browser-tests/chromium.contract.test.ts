import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PreviewRenderer } from "../src";

const document = {
  id: "browser-deck",
  name: "Browser preview",
  canvas_width: 1920,
  canvas_height: 1080,
  motion_beat_ms: 600,
  revision: 1,
  palette: {
    primary: "#ff7043", secondary: "#2dd4bf", accent: "#60a5fa",
    background: "#090d16", text: "#f4f7fb", subtext: "#94a0b4",
  },
  history: { can_undo: false, can_redo: false },
  slides: [{
    id: "slide", position: 0, name: "Slide", is_template: false,
    background: {
      kind: "linear-gradient", solid_color: null,
      gradient_start: "#090d16", gradient_end: "#18243c", angle_deg: 90,
    },
    animation: {
      in: { preset: "fade", duration_multiplier: 1, effective_duration_ms: 600 },
      out: { preset: "fade", duration_multiplier: 1, effective_duration_ms: 600 },
    },
    elements: [{
      id: "headline", state_id: "headline-state", kind: "text", name: "Headline",
      is_locked: false, semantic_role: "title",
      rect: { x: 120, y: 120, width: 1200, height: 180 },
      rotation_deg: 0, opacity: 1, z_index: 1,
      text: {
        content: "Govern AI through better paths",
        font_family: "Poppins", font_size: 72, font_weight: 700,
        line_height: 1.1, letter_spacing: 0,
        horizontal_alignment: "left", vertical_alignment: "top", overflow_mode: "hidden",
        color: "#f4f7fb", rendered_text_bounds: null, measurement_source: "estimated",
      },
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
    } finally {
      await renderer.close();
    }
  });
});
