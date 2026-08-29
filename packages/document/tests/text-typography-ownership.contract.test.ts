import { describe, expect, it } from "vitest";
import {
  applyDeksCommand,
  assertDeksDocument,
  migrateDeksDocument,
  type DeksDocument,
} from "../src/index.js";

const motion = {
  in: { animation: { kind: "fade" as const }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-out" as const },
  out: { animation: { kind: "fade" as const }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-in" as const },
  morph: { animation: { kind: "morph" as const }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-in-out" as const },
};

function canonical(): DeksDocument {
  return {
    format: "deks",
    codecVersion: 3,
    id: "text-ownership",
    name: "Text ownership",
    revision: 0,
    canvas: { width: 1920, height: 1080 },
    motionBeatMs: 600,
    motion,
    palette: {
      primary: "#ff7043", secondary: "#65c18c", accent: "#73a7ff",
      background: "#0b0c0e", text: "#f2f1ec", subtext: "#969da6",
    },
    history: { canUndo: false, canRedo: false },
    assets: [],
    elements: [{
      id: "title",
      kind: "text",
      name: "Title",
      content: "One persistent title",
      fontFamily: "Poppins",
      horizontalAlignment: "left",
      verticalAlignment: "top",
      overflowMode: "hidden",
      isLocked: false,
    }],
    slides: ["one", "two"].map((id, index) => ({
      id,
      name: id,
      isTemplate: false,
      background: { kind: "solid" as const, color: "#0b0c0e" },
      states: [{
        elementId: "title",
        x: 100 + index * 100,
        y: 120,
        width: 800,
        height: 160,
        rotationDeg: 0,
        opacity: 1,
        zIndex: 1,
        fill: "#f2f1ec",
        fontSize: 64 + index * 8,
        fontWeight: 700,
        lineHeight: 1.1,
        letterSpacing: 0,
        ...(index === 0 ? {} : { padding: { top: 8, right: 16, bottom: 24, left: 32 } }),
      }],
    })),
  };
}

function legacy(alignmentOnSecond: "left" | "center" = "left"): unknown {
  const source = canonical() as unknown as Record<string, unknown>;
  delete source.codecVersion;
  const elements = source.elements as Array<Record<string, unknown>>;
  const slides = source.slides as Array<{ states: Array<Record<string, unknown>> }>;
  for (const field of ["content", "fontFamily", "horizontalAlignment", "verticalAlignment", "overflowMode"] as const) {
    const value = elements[0]![field];
    delete elements[0]![field];
    for (const slide of slides) slide.states[0]![field] = value;
  }
  slides[1]!.states[0]!.horizontalAlignment = alignmentOnSecond;
  return source;
}

describe("text typography ownership", () => {
  it("stores fixed text decisions only on identity and continuous values on states", () => {
    const document = canonical();
    expect(() => assertDeksDocument(document)).not.toThrow();

    const fixedOnState = structuredClone(document);
    Object.assign(fixedOnState.slides[0]!.states[0]!, { horizontalAlignment: "center" });
    expect(() => assertDeksDocument(fixedOnState)).toThrow(/horizontalAlignment.*unknown property/i);

    const missingIdentity = structuredClone(document);
    delete missingIdentity.elements[0]!.fontFamily;
    expect(() => assertDeksDocument(missingIdentity)).toThrow(/fontFamily.*required.*text identit/i);
  });

  it("accepts one exact four-sided padding object, while omission means four zeros", () => {
    const valid = canonical();
    expect(() => assertDeksDocument(valid)).not.toThrow();

    for (const padding of [
      { top: 0, right: 0, bottom: 0 },
      { top: 0, right: 0, bottom: 0, left: 0, inline: 0 },
      { top: -1, right: 0, bottom: 0, left: 0 },
    ]) {
      const invalid = structuredClone(valid);
      invalid.slides[0]!.states[0]!.padding = padding as never;
      expect(() => assertDeksDocument(invalid)).toThrow(/padding/i);
    }
  });

  it("edits alignment as identity and rejects the same property as a slide-state edit", () => {
    const source = canonical();
    const aligned = applyDeksCommand(source, {
      type: "update-element-identity",
      elementId: "title",
      patch: { horizontalAlignment: "center" },
    }).document;

    expect(aligned.elements[0]!.horizontalAlignment).toBe("center");
    expect(aligned.slides.map((slide) => slide.states[0])).toEqual(source.slides.map((slide) => slide.states[0]));
    expect(() => applyDeksCommand(source, {
      type: "update-element-state",
      slideId: "one",
      elementId: "title",
      patch: { horizontalAlignment: "center" },
    })).toThrow(/horizontalAlignment.*identity/i);
  });

  it("explicitly migrates legacy state-owned fields only when every checkpoint agrees", () => {
    const input = legacy();
    const before = structuredClone(input);
    const result = migrateDeksDocument(input);

    expect(result).toEqual(expect.objectContaining({ warnings: [], fromVersion: 1, toVersion: 3 }));
    expect(result.document.elements[0]).toEqual(expect.objectContaining({
      content: "One persistent title",
      fontFamily: "Poppins",
      horizontalAlignment: "left",
      verticalAlignment: "top",
      overflowMode: "hidden",
    }));
    for (const slide of result.document.slides) {
      expect(slide.states[0]).not.toHaveProperty("content");
      expect(slide.states[0]).not.toHaveProperty("horizontalAlignment");
    }
    expect(() => assertDeksDocument(result.document)).not.toThrow();
    expect(input).toEqual(before);
  });

  it("migrates an unmarked v1 conflict first-state-wins with a structured source warning", () => {
    const input = legacy("center");
    const before = structuredClone(input);
    const result = migrateDeksDocument(input);

    expect(result.document.codecVersion).toBe(3);
    expect(result.document.elements[0]!.horizontalAlignment).toBe("left");
    expect(result.warnings).toEqual([{
      code: "text-identity-conflict",
      elementId: "title",
      field: "horizontalAlignment",
      chosenSlideId: "one",
      chosenSignature: "\"left\"",
      ignored: [{ slideId: "two", signature: "\"center\"" }],
    }]);
    expect(input).toEqual(before);
  });

  it("accepts explicit v1, is idempotent on v3, and rejects future codec versions", () => {
    const explicit = legacy() as Record<string, unknown>;
    explicit.codecVersion = 1;
    const first = migrateDeksDocument(explicit);
    const second = migrateDeksDocument(first.document);
    expect(second).toEqual({ document: first.document, warnings: [], fromVersion: 3, toVersion: 3 });

    const future = canonical() as unknown as Record<string, unknown>;
    future.codecVersion = 4;
    expect(() => migrateDeksDocument(future)).toThrow(/future.*codecVersion 4/i);
  });

  it("rejects v1 at the strict v3 boundary and names the explicit migration", () => {
    expect(() => assertDeksDocument(legacy())).toThrow(/codecVersion.*migrateDeksDocument/i);
  });
});
