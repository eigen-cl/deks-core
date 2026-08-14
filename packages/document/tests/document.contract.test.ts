import { describe, expect, it } from "vitest";
import {
  applyDeksCommand,
  assertDeksDocument,
  isHttpsUrl,
  parseDeksDocumentJson,
  type DeksDocument,
} from "../src";

const document = (): DeksDocument => ({
  id: "demo",
  name: "Demo",
  revision: 0,
  canvasWidth: 1920,
  canvasHeight: 1080,
  motionBeatMs: 600,
  palette: {
    primary: "#ff7043",
    secondary: "#65c18c",
    accent: "#73a7ff",
    background: "#0b0c0e",
    text: "#f2f1ec",
    subtext: "#969da6",
  },
  history: { canUndo: false, canRedo: false },
  slides: [
    {
      id: "slide-1",
      name: "Inicio",
      isTemplate: false,
      background: { kind: "solid", color: "#0b0c0e" },
      inPreset: "fade",
      outPreset: "fade",
      inDurationMultiplier: 1,
      outDurationMultiplier: 1,
      elements: [],
    },
  ],
  transitions: [],
});

describe("portable document contract", () => {
  it("parses the current DEKS document without changing its portable shape", () => {
    expect(parseDeksDocumentJson(JSON.stringify(document()))).toEqual(document());
  });

  it("rejects unsafe link actions and malformed graph references", () => {
    const unsafe = document();
    unsafe.slides[0]!.elements.push({
      id: "link",
      kind: "link-button",
      name: "Unsafe",
      x: 0,
      y: 0,
      width: 320,
      height: 80,
      rotationDeg: 0,
      opacity: 1,
      zIndex: 1,
      label: "Open",
      url: "javascript:alert(1)",
      fill: "#ff7043",
      textColor: "#ffffff",
    });
    expect(() => assertDeksDocument(unsafe)).toThrow(/url/i);

    const dangling = document();
    dangling.transitions.push({
      fromSlideId: "slide-1",
      toSlideId: "missing",
      motionBeatMs: 600,
      durationMultiplier: 1,
      effectiveDurationMs: 600,
      delayMs: 0,
      easing: "ease-in-out",
    });
    expect(() => assertDeksDocument(dangling)).toThrow(/slideId/i);
  });

  it("brands only absolute credential-free HTTPS URLs", () => {
    expect(isHttpsUrl("https://deks.eigen.cl/examples")).toBe(true);
    expect(isHttpsUrl("https://user:secret@deks.eigen.cl")).toBe(false);
    expect(isHttpsUrl("/examples")).toBe(false);
    expect(isHttpsUrl("data:text/html,hello")).toBe(false);
  });
});

describe("pure commands", () => {
  it("updates without mutating the input and rebuilds adjacent transitions", () => {
    const source = document();
    const next = applyDeksCommand(source, {
      type: "create-slide",
      slide: { ...source.slides[0]!, id: "slide-2", name: "Segundo" },
      afterSlideId: "slide-1",
    });

    expect(source.slides).toHaveLength(1);
    expect(next).not.toBe(source);
    expect(next.revision).toBe(1);
    expect(next.history).toEqual({ canUndo: true, canRedo: false });
    expect(next.slides.map(({ id }) => id)).toEqual(["slide-1", "slide-2"]);
    expect(next.transitions).toEqual([
      expect.objectContaining({ fromSlideId: "slide-1", toSlideId: "slide-2" }),
    ]);
  });

  it("fails closed for commands that target missing domain objects", () => {
    expect(() =>
      applyDeksCommand(document(), {
        type: "delete-slide",
        slideId: "missing",
      }),
    ).toThrow(/missing/i);
  });
});
