import { describe, expect, it } from "vitest";
import {
  DeksPresentation,
  type DeksPresentationDocument,
  type PresentationIdFactory,
} from "../src/presentation.js";

const sequenceFactory = (): PresentationIdFactory => {
  const counters = new Map<string, number>();
  return (scope) => {
    const next = (counters.get(scope) ?? 0) + 1;
    counters.set(scope, next);
    return `${scope}-${next}`;
  };
};

describe("DeksPresentation canonical v2 contract", () => {
  it("creates globally unique default presentation ids and namespaces each registry", () => {
    const first = new DeksPresentation({ name: "First" });
    const second = new DeksPresentation({ name: "Second" });
    const firstElement = first.defineElement({ kind: "text", name: "Title" });
    const secondElement = second.defineElement({ kind: "text", name: "Title" });

    expect(first.id).not.toBe(second.id);
    expect(firstElement.id.startsWith(`${first.id}:`)).toBe(true);
    expect(secondElement.id.startsWith(`${second.id}:`)).toBe(true);
    expect(firstElement.id).not.toBe(secondElement.id);
  });

  it("keeps element identity in a global registry and slide-specific data in states", () => {
    const presentation = new DeksPresentation({
      id: "governance",
      name: "Governar la IA",
      canvas: { width: 1600, height: 900 },
      idFactory: sequenceFactory(),
    });
    const title = presentation.defineElement({
      id: "title",
      kind: "text",
      name: "Titulo principal",
      defaults: { content: "Gobernar sin frenar", fill: "#f2f1ec", fontSize: 64 },
    });
    const unused = presentation.defineElement({ kind: "icon", name: "Escudo sin colocar" });
    const intro = presentation.addSlide({ id: "intro", name: "Introduccion" });
    intro.place(title, { x: 120, y: 120, width: 900, height: 120 });
    const detail = presentation.addSlide({ id: "detail", name: "Detalle" });
    detail.continue(title, { x: 120, y: 72, width: 1100, height: 96 });

    expect(title.id).toBe("governance:title");
    expect(unused.id).toBe("governance:element-1");
    expect(presentation.toDocument()).toEqual({
      format: "deks",
      version: 2,
      id: "governance",
      name: "Governar la IA",
      revision: 0,
      canvas: { width: 1600, height: 900 },
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
      assets: [],
      elements: [
        { id: "governance:title", kind: "text", name: "Titulo principal", isLocked: false },
        { id: "governance:element-1", kind: "icon", name: "Escudo sin colocar", isLocked: false },
      ],
      slides: [
        {
          id: "intro",
          name: "Introduccion",
          isTemplate: false,
          background: { kind: "solid", color: "#0b0c0e" },
          inPreset: "fade",
          outPreset: "fade",
          inDurationMultiplier: 1,
          outDurationMultiplier: 1,
          states: [{
            elementId: "governance:title",
            x: 120,
            y: 120,
            width: 900,
            height: 120,
            rotationDeg: 0,
            opacity: 1,
            zIndex: 0,
            content: "Gobernar sin frenar",
            fill: "#f2f1ec",
            fontSize: 64,
          }],
        },
        {
          id: "detail",
          name: "Detalle",
          isTemplate: false,
          background: { kind: "solid", color: "#0b0c0e" },
          inPreset: "fade",
          outPreset: "fade",
          inDurationMultiplier: 1,
          outDurationMultiplier: 1,
          states: [{
            elementId: "governance:title",
            x: 120,
            y: 72,
            width: 1100,
            height: 96,
            rotationDeg: 0,
            opacity: 1,
            zIndex: 0,
            content: "Gobernar sin frenar",
            fill: "#f2f1ec",
            fontSize: 64,
          }],
        },
      ],
      transitions: [{
        fromSlideId: "intro",
        toSlideId: "detail",
        motionBeatMs: 600,
        durationMultiplier: 1,
        effectiveDurationMs: 600,
        delayMs: 0,
        easing: "ease-in-out",
      }],
    } satisfies DeksPresentationDocument);
  });

  it("copies from an explicit prior slide and preserves absence as no state", () => {
    const presentation = new DeksPresentation({ id: "story", name: "Story" });
    const shape = presentation.defineElement({
      id: "hero",
      kind: "shape",
      shapeKind: "rectangle",
      name: "Hero",
      defaults: { shapeFill: { kind: "solid", color: "#ff7043" } },
    });
    const first = presentation.addSlide({ id: "first", name: "First" });
    first.place(shape, { x: 0, y: 0, width: 100, height: 100 });
    presentation.addSlide({ id: "absent", name: "Absent" });
    const third = presentation.addSlide({ id: "third", name: "Third" });
    third.continue(shape, { width: 200 }, { from: first });

    const document = presentation.toDocument();
    expect(document.slides[1]!.states).toEqual([]);
    expect(document.slides[2]!.states[0]).toMatchObject({
      elementId: "story:hero",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it("rejects duplicated identity, foreign namespaces, duplicate states, and invalid continuity", () => {
    const presentation = new DeksPresentation({ id: "safe", name: "Safe" });
    const title = presentation.defineElement({ id: "title", kind: "text", name: "Title" });
    expect(() => presentation.defineElement({ id: "title", kind: "shape", name: "Collision" })).toThrow(/already exists/i);
    expect(() => presentation.defineElement({ id: "other:title", kind: "text", name: "Foreign" })).toThrow(/namespace/i);

    const first = presentation.addSlide({ id: "first", name: "First" });
    const second = presentation.addSlide({ id: "second", name: "Second" });
    expect(() => first.continue(title, { x: 0 })).toThrow(/previous state/i);
    first.place(title, { x: 0, y: 0, width: 100, height: 50 });
    expect(() => first.place(title, { x: 1, y: 1, width: 100, height: 50 })).toThrow(/already has a state/i);
    expect(() => second.continue(title, {}, { from: second })).toThrow(/earlier slide/i);

    const another = new DeksPresentation({ id: "other", name: "Other" });
    const foreign = another.defineElement({ id: "title", kind: "text", name: "Title" });
    expect(() => second.place(foreign, { x: 0, y: 0, width: 1, height: 1 })).toThrow(/does not belong/i);
  });

  it("returns defensive snapshots and stable JSON without exposing mutable internals", () => {
    const presentation = new DeksPresentation({ id: "copy", name: "Copy" });
    const title = presentation.defineElement({ id: "title", kind: "text", name: "Title" });
    const slide = presentation.addSlide({ id: "slide", name: "Slide" });
    const mutableState = { x: 10, y: 20, width: 300, height: 80, content: "Original" };
    slide.place(title, mutableState);
    mutableState.content = "Mutated outside";

    const first = presentation.toDocument();
    first.name = "Mutated snapshot";
    first.slides[0]!.states[0]!.content = "Mutated snapshot";
    const second = presentation.toDocument();

    expect(second.name).toBe("Copy");
    expect(second.slides[0]!.states[0]!.content).toBe("Original");
    expect(presentation.asJSON()).toBe(JSON.stringify(second));
    expect(presentation.asJSON({ pretty: true })).toBe(JSON.stringify(second, null, 2));
  });

  it("validates required finite geometry and deterministic identifiers", () => {
    const duplicateFactory: PresentationIdFactory = () => "same";
    const presentation = new DeksPresentation({ id: "validation", name: "Validation", idFactory: duplicateFactory });
    const element = presentation.defineElement({ kind: "text", name: "Text" });
    expect(() => presentation.defineElement({ kind: "text", name: "Other" })).toThrow(/already exists/i);

    const slide = presentation.addSlide({ name: "Slide" });
    expect(() => presentation.addSlide({ name: "Other" })).toThrow(/already exists/i);
    expect(() => slide.place(element, { x: 0, y: 0, width: 0, height: 20 })).toThrow(/width/i);
    expect(() => slide.place(element, { x: Number.NaN, y: 0, width: 20, height: 20 })).toThrow(/x/i);
  });

  it("keeps runtime byte and Blob sources out of the serializable asset registry", () => {
    const presentation = new DeksPresentation({ id: "assets", name: "Assets" });
    presentation.addSlide({ id: "slide", name: "Slide" });
    const bytes = presentation.defineAsset({
      kind: "bytes",
      id: "hero",
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
      originalFilename: "hero.png",
    });
    const blob = presentation.defineAsset({
      kind: "blob",
      id: "photo",
      blob: new Blob([new Uint8Array([4, 5])], { type: "image/jpeg" }),
      originalFilename: "photo.jpg",
    });
    const remote = presentation.defineAsset({ kind: "url", id: "remote", url: "https://assets.example/hero.png" });

    expect(presentation.toDocument().assets).toEqual([
      { id: "assets:hero", kind: "embedded", mediaType: "image/png", originalFilename: "hero.png" },
      { id: "assets:photo", kind: "embedded", mediaType: "image/jpeg", originalFilename: "photo.jpg" },
      { id: "assets:remote", kind: "remote", url: "https://assets.example/hero.png" },
    ]);
    expect(presentation.getAssetRuntimeSource(bytes)).toMatchObject({ kind: "bytes", mediaType: "image/png" });
    expect(presentation.getAssetRuntimeSource(blob)).toMatchObject({ kind: "blob", mediaType: "image/jpeg" });
    expect(presentation.getAssetRuntimeSource(remote)).toBeUndefined();
    expect(JSON.stringify(presentation.toDocument())).not.toContain("[object Blob]");
    expect(() => presentation.defineAsset({ kind: "url", url: "http://assets.example/unsafe.png" })).toThrow(/HTTPS/i);
    expect(() => presentation.defineAsset({ kind: "url", url: "blob:https://app.example/runtime" })).toThrow(/HTTPS/i);
  });
});
