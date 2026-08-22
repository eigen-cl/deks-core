import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { DEFAULT_MOTION, mergeMotion, type MotionSpec } from "@deks-js/document";
import type { ElementSnapshot, SlideSnapshot } from "@deks-js/renderer-core";

const motion = (): MotionSpec => mergeMotion(DEFAULT_MOTION);

const rectangle = (
  id: string,
  x: number,
  animation: MotionSpec["in"]["animation"],
  delayBeats: number,
): ElementSnapshot => ({
  id,
  name: id,
  kind: "shape",
  shapeKind: "rectangle",
  rect: { x, y: 200, width: 500, height: 80 },
  rotationDeg: 0,
  opacity: 1,
  zIndex: 1,
  motion: mergeMotion(DEFAULT_MOTION, {
    in: { animation, durationBeats: 2.1, delayBeats, easing: "linear" },
  }),
  fillStyle: { kind: "solid", color: "#73A7FF" },
  stroke: "#73A7FF",
  strokeWidth: 0,
});

const oldCopy: ElementSnapshot = {
  id: "old-copy",
  name: "Old copy",
  kind: "text",
  rect: { x: 100, y: 80, width: 900, height: 100 },
  rotationDeg: 0,
  opacity: 1,
  zIndex: 2,
  motion: mergeMotion(DEFAULT_MOTION, {
    out: { animation: { kind: "fade" }, durationBeats: 6, delayBeats: 0, easing: "linear" },
  }),
  content: "Texto anterior",
  fontFamily: "Poppins",
  fontSize: 54,
  fontWeight: 600,
  lineHeight: 1.1,
  letterSpacing: 0,
  horizontalAlignment: "left",
  verticalAlignment: "top",
  color: "#ffffff",
  overflowMode: "hidden",
};

const snapshot = (id: string, elements: ElementSnapshot[]): SlideSnapshot => ({
  id,
  canvas: { width: 1920, height: 1080 },
  background: { kind: "solid", color: "#101218" },
  motionBeatMs: 100,
  motion: motion(),
  elements,
});

async function runtimePage() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: await readFile(new URL("../dist/browser-entry.js", import.meta.url), "utf8") });
  return { browser, page };
}

describe("real Chromium renderer playback", () => {
  it("holds delayed fade and wipe entrances at their first keyframe", async () => {
    const from = snapshot("from", [oldCopy]);
    const to = snapshot("to", [
      rectangle("track", 100, { kind: "fade" }, 6),
      rectangle("fill", 100, { kind: "wipe", edge: "right" }, 8.1),
    ]);
    const { browser, page } = await runtimePage();
    try {
      const samples = await page.evaluate(async (input) => {
        const runtime = (globalThis as typeof globalThis & {
          DeksPreviewBrowser: { probeTransition(value: typeof input): Promise<unknown> };
        }).DeksPreviewBrowser;
        return runtime.probeTransition(input);
      }, { from, to, samples: [300, 599, 700, 810, 900], elementIds: ["old-copy", "track", "fill"] }) as Array<{
        time: number;
        elements: Record<string, { opacity: string; clipPath: string; text: string }>;
      }>;

      expect(Number(samples[0]!.elements["old-copy"]!.opacity)).toBeGreaterThan(0);
      expect(samples[0]!.elements.track!.opacity).toBe("0");
      expect(samples[1]!.elements.track!.opacity).toBe("0");
      expect(samples[0]!.elements.fill!.clipPath).toContain("100%");
      expect(samples[2]!.elements.fill!.clipPath).toContain("100%");
      expect(Number(samples[2]!.elements.track!.opacity)).toBeGreaterThan(0);
      expect(samples[3]!.elements.fill!.clipPath).toContain("100%");
      expect(samples[4]!.elements.fill!.clipPath).not.toContain("100%");
    } finally {
      await browser.close();
    }
  });

  it("resolves delayed fade, wipe and crop playback and reconciles one destination scene", async () => {
    const from = snapshot("from", [oldCopy]);
    const to = snapshot("to", [
      rectangle("fade", 100, { kind: "fade" }, 1),
      rectangle("wipe", 700, { kind: "wipe", edge: "right" }, 2),
      rectangle("crop", 1300, { kind: "crop", edge: "left" }, 3),
    ]);
    const { browser, page } = await runtimePage();
    try {
      const result = await page.evaluate(async (input) => {
        const runtime = (globalThis as typeof globalThis & {
          DeksPreviewBrowser: { completeTransition(value: typeof input): Promise<unknown> };
        }).DeksPreviewBrowser;
        return runtime.completeTransition(input);
      }, { from, to, playbackRate: 20 }) as {
        progress: number;
        elementIds: string[];
        transitionLayers: number;
        cropLayers: number;
      };

      expect(result.progress).toBe(1);
      expect(result.elementIds.sort()).toEqual(["crop", "fade", "wipe"]);
      expect(result.transitionLayers).toBe(0);
      expect(result.cropLayers).toBe(0);
    } finally {
      await browser.close();
    }
  });
});
