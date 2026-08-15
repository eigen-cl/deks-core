import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertDeksPresentationDocument,
  deksPresentationSchema,
  parseDeksPresentationJson,
  type DeksPresentationDocument,
} from "../src";

const valid = (): DeksPresentationDocument => ({
  format: "deks",
  version: 2,
  id: "deck-1",
  name: "Demo",
  revision: 0,
  canvas: { width: 1600, height: 900 },
  motionBeatMs: 600,
  palette: {
    primary: "#ff7043", secondary: "#65c18c", accent: "#73a7ff",
    background: "#0b0c0e", text: "#f2f1ec", subtext: "#969da6",
  },
  history: { canUndo: false, canRedo: false },
  assets: [],
  elements: [{ id: "deck-1:title", kind: "text", name: "Title", isLocked: false }],
  slides: [{
    id: "deck-1:slide-1",
    name: "Intro",
    isTemplate: false,
    background: { kind: "solid", color: "#0b0c0e" },
    inPreset: "fade",
    outPreset: "fade",
    inDurationMultiplier: 1,
    outDurationMultiplier: 1,
    states: [{
      elementId: "deck-1:title",
      x: 100, y: 100, width: 800, height: 100,
      rotationDeg: 0, opacity: 1, zIndex: 1,
      content: "Hello", fontFamily: "Poppins", fontSize: 64,
      fontWeight: 700, lineHeight: 1.1, letterSpacing: 0,
      horizontalAlignment: "left", verticalAlignment: "top",
      overflowMode: "hidden", fill: "#f2f1ec",
    }],
  }],
  transitions: [],
});

describe("canonical v2 validation", () => {
  it("keeps JSON Schema discovery metadata internally consistent", () => {
    for (const field of deksPresentationSchema.required) {
      expect(deksPresentationSchema.properties).toHaveProperty(field);
    }
  });

  it("accepts the single cross-runtime v2 compatibility fixture", () => {
    const fixture = readFileSync(new URL("./fixtures/presentation-v2.complete.json", import.meta.url), "utf8");
    expect(parseDeksPresentationJson(fixture)).toMatchObject({ format: "deks", version: 2, revision: 7 });
  });

  it("accepts a registry-backed document and returns it from the parser", () => {
    const source = valid();
    expect(parseDeksPresentationJson(JSON.stringify(source))).toEqual(source);
  });

  it("strictly validates per-corner rectangle radii", () => {
    const source = valid();
    source.elements.push({
      id: "deck-1:frame", kind: "shape", shapeKind: "rectangle", name: "Frame", isLocked: false,
    });
    source.slides[0]!.states.push({
      elementId: "deck-1:frame",
      x: 80, y: 240, width: 1000, height: 480,
      rotationDeg: 0, opacity: 1, zIndex: 0,
      fill: "#ff7043", cornerRadius: 20,
      cornerRadii: { topLeft: 4, topRight: 12, bottomRight: 20, bottomLeft: 28 },
    });
    expect(() => assertDeksPresentationDocument(source)).not.toThrow();

    const malformed = structuredClone(source);
    malformed.slides[0]!.states[1]!.cornerRadii = {
      topLeft: 4, topRight: 12, bottomRight: 20, bottomLeft: Number.NaN,
    };
    expect(() => assertDeksPresentationDocument(malformed)).toThrow(/cornerRadii/i);
  });

  it("rejects states whose identity is not declared", () => {
    const source = valid();
    source.slides[0]!.states[0]!.elementId = "deck-1:missing";
    expect(() => assertDeksPresentationDocument(source)).toThrow(/declared|elementId/i);
  });

  it("rejects duplicate identities and duplicate state references", () => {
    const duplicateIdentity = valid();
    duplicateIdentity.elements.push({ ...duplicateIdentity.elements[0]! });
    expect(() => assertDeksPresentationDocument(duplicateIdentity)).toThrow(/elements.*id|duplicate/i);

    const duplicateState = valid();
    duplicateState.slides[0]!.states.push({ ...duplicateState.slides[0]!.states[0]! });
    expect(() => assertDeksPresentationDocument(duplicateState)).toThrow(/states.*elementId|duplicate/i);
  });

  it("validates subtype state against the registered kind", () => {
    const source = valid();
    source.slides[0]!.states[0] = {
      elementId: "deck-1:title",
      x: 100, y: 100, width: 80, height: 80,
      rotationDeg: 0, opacity: 1, zIndex: 1,
      iconFamily: "lucide", iconName: "shield-check", fill: "#ff7043", strokeWidth: 2,
    };
    expect(() => assertDeksPresentationDocument(source)).toThrow(/text|content|unknown property/i);
  });

  it("rejects transition element references outside the transition endpoints", () => {
    const source = valid();
    source.elements.push({ id: "deck-1:other", kind: "shape", shapeKind: "rectangle", name: "Other", isLocked: false });
    source.slides.push({
      ...source.slides[0]!,
      id: "deck-1:slide-2",
      name: "Second",
      states: [],
    });
    source.transitions.push({
      fromSlideId: "deck-1:slide-1",
      toSlideId: "deck-1:slide-2",
      motionBeatMs: 600,
      durationMultiplier: 1,
      effectiveDurationMs: 600,
      delayMs: 0,
      easing: "ease-in-out",
      overrides: [{ elementId: "deck-1:other", animate: true }],
    });
    expect(() => assertDeksPresentationDocument(source)).toThrow(/endpoint|elementId/i);
  });

  it("rejects unknown top-level properties", () => {
    expect(() => assertDeksPresentationDocument({ ...valid(), surprise: true })).toThrow(/surprise|property/i);
  });
});
