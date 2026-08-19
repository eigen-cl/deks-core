import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it, vi } from "vitest";
import {
  DeksPresentation,
  DEKS_DOCUMENT_LIMITS,
  assertDeksDocument,
  deksDocumentSchema,
  effectiveDurationMs,
  parseDeksJson,
  resolveElementMotion,
  resolveSlideMotion,
  type DeksDocument,
} from "../src";

const golden = () => JSON.parse(readFileSync(
  new URL("./fixtures/deks-document.canonical.json", import.meta.url),
  "utf8",
)) as DeksDocument;
const schema = JSON.parse(readFileSync(
  new URL("../src/schema/deks-document.schema.json", import.meta.url),
  "utf8",
)) as object;

describe("canonical DEKS JSON", () => {
  it("refuses to serialize a presentation beyond the universal JSON byte limit", () => {
    const presentation = new DeksPresentation({ id: "large-deck", name: "Large deck" });
    const slide = presentation.addSlide({ id: "slide-1", name: "Only slide" });
    for (let index = 0; index < 55; index += 1) {
      const element = presentation.defineElement({
        id: `text-${index}`,
        kind: "text",
        name: `Text ${index}`,
        defaults: {
          content: "a".repeat(DEKS_DOCUMENT_LIMITS.maxTextLength),
          fontFamily: "Poppins",
          fontSize: 32,
          fontWeight: 400,
          lineHeight: 1.2,
          letterSpacing: 0,
          horizontalAlignment: "left",
          verticalAlignment: "top",
          overflowMode: "hidden",
          fill: "#ffffff",
        },
      });
      slide.place(element, {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotationDeg: 0,
        opacity: 1,
        zIndex: index,
      });
    }

    expect(() => presentation.asJSON()).toThrow(/JSON is too large/i);
  });

  it("accepts the golden document as the only normalized contract", () => {
    const document = golden();
    expect(() => assertDeksDocument(document)).not.toThrow();
    expect(parseDeksJson(JSON.stringify(document))).toEqual(document);
    expect(document.format).toBe("deks");
    expect("version" in document).toBe(false);
    const validate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(schema);
    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
    expect(deksDocumentSchema).toEqual(schema);
  });

  it("keeps opaque ID syntax identical in schema and runtime", () => {
    const validate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(schema);
    const boundary = golden();
    boundary.id = "d".repeat(DEKS_DOCUMENT_LIMITS.maxDocumentIdCodePoints);
    expect(validate(boundary), JSON.stringify(validate.errors)).toBe(true);
    expect(() => assertDeksDocument(boundary)).not.toThrow();

    const tooLong = golden();
    tooLong.id = "d".repeat(DEKS_DOCUMENT_LIMITS.maxDocumentIdCodePoints + 1);
    expect(validate(tooLong)).toBe(false);
    expect(() => assertDeksDocument(tooLong)).toThrow(/id/i);

    const invalid = golden();
    invalid.id = "document:colon";
    expect(validate(invalid)).toBe(false);
    expect(() => assertDeksDocument(invalid)).toThrow(/id|characters/i);
  });

  it("keeps JSON Schema aligned with removed fields and subtype requirements", () => {
    const validate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(schema);
    for (const field of ["cornerRadius", "fill", "assetUrl"] as const) {
      const document = golden();
      Object.assign(document.slides[0]!.states[field === "assetUrl" ? 3 : 2]!, { [field]: field === "fill" ? "#fff" : 12 });
      expect(validate(document), `${field}: ${JSON.stringify(validate.errors)}`).toBe(false);
    }
    const missing = golden();
    delete (missing.slides[0]!.states[1] as Partial<typeof missing.slides[0]["states"][number]>).fontFamily;
    expect(validate(missing), JSON.stringify(validate.errors)).toBe(false);
    expect(() => assertDeksDocument(missing)).toThrow(/fontFamily|required/i);
  });

  it("rejects fields outside the canonical schema", () => {
    const shape = golden();
    Object.assign(shape.slides[0]!.states[2]!, { cornerRadius: 24 });
    expect(() => assertDeksDocument(shape)).toThrow(/cornerRadius|unknown property/i);

    const scalarFill = golden();
    Object.assign(scalarFill.slides[0]!.states[2]!, { fill: "#ff7043" });
    expect(() => assertDeksDocument(scalarFill)).toThrow(/fill|unknown property/i);

    const image = golden();
    Object.assign(image.slides[0]!.states[3]!, { assetUrl: "https://assets.example.com/image.png" });
    expect(() => assertDeksDocument(image)).toThrow(/assetUrl|unknown property/i);
  });

  it("publishes universal format limits without Cloud quotas", () => {
    expect(DEKS_DOCUMENT_LIMITS).toEqual(expect.objectContaining({
      maxJsonBytes: 5_000_000,
      maxJsonNodes: 200_000,
      maxSlides: 200,
      maxElements: 100_000,
      maxStatesPerSlide: 500,
      maxAssets: 10_000,
      maxTextLength: 100_000,
      maxUrlCodePoints: 2_048,
      minCanvasWidth: 320,
      minCanvasHeight: 180,
      maxCanvasDimension: 16_384,
      maxCanvasAspectRatio: 4,
      maxGeometryCoordinateMagnitude: 100_000,
      minGeometrySize: 0.1,
      maxGeometrySize: 100_000,
      maxRotationMagnitude: 36_000,
      maxZIndexMagnitude: 100_000,
      maxCornerRadius: 100_000,
      maxFontSize: 10_000,
      maxFontWeight: 1_000,
      maxLineHeight: 100,
      maxLetterSpacingMagnitude: 1_000,
      maxStrokeWidth: 1_000,
      minIconStrokeWidth: 0.5,
      maxIconStrokeWidth: 8,
      minMotionBeatMs: 50,
      maxMotionBeatMs: 60_000,
      maxMotionDelayMs: 60_000,
      maxDurationBeats: 8,
      minSlideDistance: 0.1,
      minScaleFactor: 0.01,
      maxScaleFactor: 10,
      maxNestingDepth: 128,
    }));
    expect(DEKS_DOCUMENT_LIMITS).not.toHaveProperty("cloudSlides");
    expect(DEKS_DOCUMENT_LIMITS).not.toHaveProperty("plan");
  });

  it("keeps exported universal bounds in exact parity with the JSON Schema", () => {
    expect(schema.properties.assets.maxItems).toBe(DEKS_DOCUMENT_LIMITS.maxAssets);
    expect(schema.properties.elements.maxItems).toBe(DEKS_DOCUMENT_LIMITS.maxElements);
    expect(schema.properties.slides.maxItems).toBe(DEKS_DOCUMENT_LIMITS.maxSlides);
    expect(schema.$defs.documentId.maxLength).toBe(DEKS_DOCUMENT_LIMITS.maxDocumentIdCodePoints);
    expect(schema.$defs.id.maxLength).toBe(DEKS_DOCUMENT_LIMITS.maxIdCodePoints);
    expect(schema.$defs.name.maxLength).toBe(DEKS_DOCUMENT_LIMITS.maxNameCodePoints);
    expect(schema.$defs.httpsUrl.maxLength).toBe(DEKS_DOCUMENT_LIMITS.maxUrlCodePoints);
    expect(schema.$defs.canvas.properties.width).toMatchObject({
      minimum: DEKS_DOCUMENT_LIMITS.minCanvasWidth,
      maximum: DEKS_DOCUMENT_LIMITS.maxCanvasDimension,
    });
    expect(schema.$defs.canvas.properties.height).toMatchObject({
      minimum: DEKS_DOCUMENT_LIMITS.minCanvasHeight,
      maximum: DEKS_DOCUMENT_LIMITS.maxCanvasDimension,
    });
    expect(schema.$defs.state.properties.x).toMatchObject({
      minimum: -DEKS_DOCUMENT_LIMITS.maxGeometryCoordinateMagnitude,
      maximum: DEKS_DOCUMENT_LIMITS.maxGeometryCoordinateMagnitude,
    });
    expect(schema.$defs.state.properties.width).toMatchObject({
      minimum: DEKS_DOCUMENT_LIMITS.minGeometrySize,
      maximum: DEKS_DOCUMENT_LIMITS.maxGeometrySize,
    });
    expect(schema.$defs.state.properties.rotationDeg).toMatchObject({
      minimum: -DEKS_DOCUMENT_LIMITS.maxRotationMagnitude,
      maximum: DEKS_DOCUMENT_LIMITS.maxRotationMagnitude,
    });
    expect(schema.$defs.state.properties.zIndex).toMatchObject({
      minimum: -DEKS_DOCUMENT_LIMITS.maxZIndexMagnitude,
      maximum: DEKS_DOCUMENT_LIMITS.maxZIndexMagnitude,
    });
    expect(schema.$defs.state.properties.content.maxLength).toBe(DEKS_DOCUMENT_LIMITS.maxTextLength);
    expect(schema.$defs.state.properties.fontSize).toMatchObject({ minimum: DEKS_DOCUMENT_LIMITS.minFontSize, maximum: DEKS_DOCUMENT_LIMITS.maxFontSize });
    expect(schema.$defs.state.properties.fontWeight).toMatchObject({ minimum: DEKS_DOCUMENT_LIMITS.minFontWeight, maximum: DEKS_DOCUMENT_LIMITS.maxFontWeight });
    expect(schema.$defs.state.properties.lineHeight).toMatchObject({ minimum: DEKS_DOCUMENT_LIMITS.minLineHeight, maximum: DEKS_DOCUMENT_LIMITS.maxLineHeight });
    expect(schema.$defs.state.properties.letterSpacing).toMatchObject({ minimum: -DEKS_DOCUMENT_LIMITS.maxLetterSpacingMagnitude, maximum: DEKS_DOCUMENT_LIMITS.maxLetterSpacingMagnitude });
    expect(schema.$defs.state.properties.strokeWidth.maximum).toBe(DEKS_DOCUMENT_LIMITS.maxStrokeWidth);
    expect(schema.$defs.state.properties.cornerRadius.maximum).toBe(DEKS_DOCUMENT_LIMITS.maxCornerRadius);
    expect(schema.$defs.slide.properties.states.maxItems).toBe(DEKS_DOCUMENT_LIMITS.maxStatesPerSlide);
    expect(schema.$defs.beat).toMatchObject({ minimum: DEKS_DOCUMENT_LIMITS.minMotionBeatMs, maximum: DEKS_DOCUMENT_LIMITS.maxMotionBeatMs });
    expect(schema.$defs.motionDelayMs.maximum).toBe(DEKS_DOCUMENT_LIMITS.maxMotionDelayMs);
    expect(schema.$defs.durationBeats.maximum).toBe(DEKS_DOCUMENT_LIMITS.maxDurationBeats);
    // Looked up by kind, not by position: adding an animation must not be able
    // to make this assertion silently check a different one.
    const presence = (kind: string) => schema.$defs.presenceAnimation.oneOf
      .find((variant: { properties: { kind: { const?: string; enum?: string[] } } }) =>
        variant.properties.kind.const === kind || variant.properties.kind.enum?.includes(kind))!;
    expect(presence("slide").properties.distance.minimum).toBe(DEKS_DOCUMENT_LIMITS.minSlideDistance);
    expect(presence("scale").properties.from).toMatchObject({
      minimum: DEKS_DOCUMENT_LIMITS.minScaleFactor,
      maximum: DEKS_DOCUMENT_LIMITS.maxScaleFactor,
    });
    // Crop travels the element's own extent, so it must not accept a distance.
    expect(Object.keys(presence("crop").properties).sort()).toEqual(["edge", "kind"]);
    expect(schema.$defs.state.properties.value).toMatchObject({
      minimum: -DEKS_DOCUMENT_LIMITS.maxNumberValueMagnitude,
      maximum: DEKS_DOCUMENT_LIMITS.maxNumberValueMagnitude,
    });
    expect(schema.$defs.state.properties.decimals.maximum).toBe(DEKS_DOCUMENT_LIMITS.maxNumberDecimals);
    expect(schema.$defs.state.properties.symbol.maxLength).toBe(DEKS_DOCUMENT_LIMITS.maxNumberSymbolCodePoints);
  });

  it("keeps cubic-bezier x and y bounds identical in schema and runtime", () => {
    const validate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(schema);
    const boundary = golden();
    boundary.motion.morph.easing = [0, -100, 1, 100];
    expect(validate(boundary), JSON.stringify(validate.errors)).toBe(true);
    expect(() => assertDeksDocument(boundary)).not.toThrow();

    for (const bezier of [[-1, 0, 1, 0], [0, 0, 2, 0]]) {
      const invalid = golden();
      invalid.motion.morph.easing = bezier as [number, number, number, number];
      expect(validate(invalid), JSON.stringify(bezier)).toBe(false);
      expect(() => assertDeksDocument(invalid)).toThrow(/easing/i);
    }
  });

  it("keeps safe text controls identical in schema and runtime while allowing newlines", () => {
    const validate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(schema);
    const newline = golden();
    newline.name = "Canonical\nDEKS";
    newline.slides[0]!.states[1]!.content = "Line one\nLine two";
    expect(validate(newline), JSON.stringify(validate.errors)).toBe(true);
    expect(() => assertDeksDocument(newline)).not.toThrow();

    const mutations: Array<[string, (document: DeksDocument) => void]> = [
      ["name", (document) => { document.name = "bad\u0001"; }],
      ["mediaType", (document) => { document.assets[0]!.mediaType = "image/png\u0001"; }],
      ["originalFilename", (document) => { document.assets[0]!.originalFilename = "bad\u0001.png"; }],
      ["semanticRole", (document) => { document.elements[0]!.semanticRole = "bad\u0001"; }],
      ["content", (document) => { document.slides[0]!.states[1]!.content = "bad\u0001"; }],
      ["alt", (document) => { document.slides[0]!.states[3]!.alt = "bad\u0001"; }],
      ["label", (document) => { document.slides[0]!.states[4]!.label = "bad\u0001"; }],
      ["url", (document) => { document.slides[0]!.states[4]!.url = "https://deks.eigen.cl/bad\u0001"; }],
      ["iconName", (document) => { document.slides[0]!.states[5]!.iconName = "bad\u0001"; }],
    ];
    for (const [field, mutate] of mutations) {
      const invalid = golden();
      mutate(invalid);
      expect(validate(invalid), `${field}: ${JSON.stringify(validate.errors)}`).toBe(false);
      expect(() => assertDeksDocument(invalid), field).toThrow(/control|url/i);
    }
  });

  it("rejects duplicate JSON object keys before last-wins parsing", () => {
    expect(() => parseDeksJson('{"format":"deks","format":"deks"}')).toThrow(/duplicate object key format/i);
  });

  it("rejects excessive JSON nodes before invoking JSON.parse", () => {
    const serialized = `[${new Array(DEKS_DOCUMENT_LIMITS.maxJsonNodes).fill("{}").join(",")}]`;
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(DEKS_DOCUMENT_LIMITS.maxJsonBytes);
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(() => parseDeksJson(serialized)).toThrow(/JSON.*nodes|complex/i);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it("counts Unicode scalar values and bounds canvas aspect ratio", () => {
    const atLimit = golden();
    atLimit.slides[0]!.states[1]!.content = "😀".repeat(DEKS_DOCUMENT_LIMITS.maxTextLength);
    expect(() => assertDeksDocument(atLimit)).not.toThrow();
    atLimit.slides[0]!.states[1]!.content += "😀";
    expect(() => assertDeksDocument(atLimit)).toThrow(/content/i);

    const tooWide = golden();
    tooWide.canvas = { width: 4000, height: 999 };
    expect(() => assertDeksDocument(tooWide)).toThrow(/aspect ratio/i);
    const tooTall = golden();
    tooTall.canvas = { width: 320, height: 1281 };
    expect(() => assertDeksDocument(tooTall)).toThrow(/aspect ratio/i);
  });

  it("applies exported URL, canvas, geometry and transition collection bounds at runtime", () => {
    const validate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(schema);
    const atLimit = golden();
    atLimit.canvas = {
      width: DEKS_DOCUMENT_LIMITS.maxCanvasDimension,
      height: DEKS_DOCUMENT_LIMITS.maxCanvasDimension,
    };
    atLimit.slides[0]!.states[0]!.x = DEKS_DOCUMENT_LIMITS.maxGeometryCoordinateMagnitude;
    atLimit.slides[0]!.states[0]!.width = DEKS_DOCUMENT_LIMITS.minGeometrySize;
    const prefix = "https://example.com/";
    atLimit.slides[0]!.states[4]!.url = prefix + "a".repeat(DEKS_DOCUMENT_LIMITS.maxUrlCodePoints - prefix.length);
    expect(validate(atLimit), JSON.stringify(validate.errors)).toBe(true);
    expect(() => assertDeksDocument(atLimit)).not.toThrow();

    atLimit.slides[0]!.states[4]!.url += "a";
    expect(validate(atLimit)).toBe(false);
    expect(() => assertDeksDocument(atLimit)).toThrow(/url/i);

    const tooSmall = golden();
    tooSmall.slides[0]!.states[0]!.width = DEKS_DOCUMENT_LIMITS.minGeometrySize / 2;
    expect(validate(tooSmall)).toBe(false);
    expect(() => assertDeksDocument(tooSmall)).toThrow(/width/i);

    const iconStroke = golden();
    iconStroke.slides[0]!.states[5]!.strokeWidth = DEKS_DOCUMENT_LIMITS.maxIconStrokeWidth + 1;
    expect(validate(iconStroke)).toBe(false);
    expect(() => assertDeksDocument(iconStroke)).toThrow(/strokeWidth/i);

    const tooSlow = golden();
    tooSlow.motion.morph.durationBeats = DEKS_DOCUMENT_LIMITS.maxDurationBeats + 1;
    expect(validate(tooSlow)).toBe(false);
    expect(() => assertDeksDocument(tooSlow)).toThrow(/durationBeats/i);
  });

  it("accepts valid scalar values but rejects unpaired Unicode surrogates", () => {
    const validate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(schema);
    const valid = golden();
    valid.name = "Canonical 😀";
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
    expect(parseDeksJson(JSON.stringify(valid))).toEqual(valid);

    const invalid = golden();
    invalid.name = "broken\ud800";
    expect(validate(invalid)).toBe(false);
    expect(() => assertDeksDocument(invalid)).toThrow(/surrogate/i);
    const serialized = JSON.stringify(golden()).replace('"Canonical DEKS document"', '"broken\\ud800"');
    expect(() => parseDeksJson(serialized)).toThrow(/surrogate/i);
  });

  it("derives duration from the beat with half-up rounding across runtimes", () => {
    expect(effectiveDurationMs(601, 0.5)).toBe(301);
    expect(effectiveDurationMs(600, 1.5)).toBe(900);
    expect(effectiveDurationMs(600, 0)).toBe(0);
  });

  it("resolves motion property by property from document, slide and element", () => {
    const document = golden();
    const [context, proposal] = document.slides;
    const icon = proposal!.states[1]!.elementId;

    // The document root is the only complete declaration; nothing else repeats it.
    expect(document.motion.in.animation).toEqual({ kind: "fade" });
    expect(context!.motion).toBeUndefined();
    expect(resolveSlideMotion(document, context!.id)).toEqual(document.motion);

    // The slide changes how elements arrive and how long a morph lasts.
    const slideMotion = resolveSlideMotion(document, proposal!.id);
    expect(slideMotion.in.animation).toEqual({ kind: "slide", edge: "right", distance: 240 });
    expect(slideMotion.in.easing).toBe(document.motion.in.easing);
    expect(slideMotion.morph.durationBeats).toBe(1.5);

    // The element keeps the slide duration but arrives scaled and late.
    const elementMotion = resolveElementMotion(document, proposal!.id, icon);
    expect(elementMotion.in.animation).toEqual({ kind: "scale", from: 0.8 });
    expect(elementMotion.in.delayMs).toBe(120);
    expect(elementMotion.in.durationBeats).toBe(document.motion.in.durationBeats);
    expect(elementMotion.morph).toEqual(slideMotion.morph);
  });

  it("rejects a document whose root motion is incomplete", () => {
    const document = golden();
    delete (document.motion.in as Partial<typeof document.motion.in>).easing;
    expect(() => assertDeksDocument(document)).toThrow(/motion\.in\.easing/i);

    const empty = golden();
    empty.slides[1]!.motion = {};
    expect(() => assertDeksDocument(empty)).toThrow(/motion/i);
  });

  it("rejects the removed root version and flat slide elements", () => {
    const versioned = { ...golden(), version: 2 };
    expect(() => assertDeksDocument(versioned)).toThrow(/version|unknown property/i);

    const flat = golden() as unknown as { slides: Array<Record<string, unknown>> };
    flat.slides[0]!.elements = flat.slides[0]!.states;
    delete flat.slides[0]!.states;
    expect(() => assertDeksDocument(flat)).toThrow(/elements|states|unknown property/i);
  });
});
