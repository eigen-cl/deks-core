import type { SlideTransition } from "./types.js";
import type {
  DeksAssetDescriptor,
  DeksDocument,
  DeksElement,
  DeksElementKind,
  DeksSlide,
  DeksElementState,
} from "./presentation.js";
import { isHttpsUrl } from "./validation.js";
import schema from "./schema/deks-document.schema.json" with { type: "json" };

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const ID_PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RATIOS = new Set([0.5, 0.75, 1, 1.5, 2]);
const PRESETS = new Set(["none", "fade", "glide-top", "glide-right", "glide-bottom", "glide-left"]);
const KINDS = new Set<DeksElementKind>(["text", "shape", "image", "group", "link-button", "icon"]);
const BASE_STATE_KEYS = ["elementId", "x", "y", "width", "height", "rotationDeg", "opacity", "zIndex"] as const;
const STATE_KEYS: Record<DeksElementKind, ReadonlySet<string>> = {
  text: new Set([...BASE_STATE_KEYS, "content", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "horizontalAlignment", "verticalAlignment", "overflowMode", "fill"]),
  shape: new Set([...BASE_STATE_KEYS, "shapeFill", "stroke", "strokeWidth", "cornerRadii"]),
  image: new Set([...BASE_STATE_KEYS, "assetId", "alt", "fit"]),
  group: new Set(BASE_STATE_KEYS),
  "link-button": new Set([...BASE_STATE_KEYS, "label", "url", "fill", "textColor", "fontFamily", "fontSize", "fontWeight", "cornerRadius", "stroke", "strokeWidth"]),
  icon: new Set([...BASE_STATE_KEYS, "iconFamily", "iconName", "fill", "strokeWidth"]),
};

function fail(field: string, reason = "is invalid"): never {
  throw new Error(`Invalid DEKS document: ${field} ${reason}.`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(field, "must be an object");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) fail(`${field}.${unexpected}`, "is an unknown property");
}

function text(value: unknown, field: string, max: number = DEKS_DOCUMENT_LIMITS.maxNameCodePoints, allowEmpty = false): string {
  if (typeof value !== "string" || [...value].length > max || (!allowEmpty && value.length === 0)) fail(field);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(field, "contains control characters");
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) fail(field, "contains an unpaired Unicode surrogate");
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail(field, "contains an unpaired Unicode surrogate");
    }
  }
  return value;
}

function id(value: unknown, field: string, max: number = DEKS_DOCUMENT_LIMITS.maxIdCodePoints): string {
  const parsed = text(value, field, max);
  if (!ID_PART.test(parsed)) fail(field, "contains unsupported characters");
  return parsed;
}

function numberValue(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(field);
  return value;
}

function integer(value: unknown, field: string, min: number, max: number): number {
  const valueAsNumber = numberValue(value, field, min, max);
  if (!Number.isInteger(valueAsNumber)) fail(field, "must be an integer");
  return valueAsNumber;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail(field, "must be a boolean");
  return value;
}

function color(value: unknown, field: string): void {
  if (typeof value !== "string" || !COLOR.test(value)) fail(field, "must be a hexadecimal color");
}

function choice(value: unknown, choices: ReadonlySet<unknown>, field: string): void {
  if (!choices.has(value)) fail(field, "is unsupported");
}

function background(value: unknown, field: string): void {
  const item = record(value, field);
  if (item.kind === "solid") {
    exactKeys(item, new Set(["kind", "color"]), field);
    color(item.color, `${field}.color`);
    return;
  }
  if (item.kind !== "linear-gradient") fail(`${field}.kind`);
  exactKeys(item, new Set(["kind", "startColor", "endColor", "angleDeg"]), field);
  color(item.startColor, `${field}.startColor`);
  color(item.endColor, `${field}.endColor`);
  numberValue(item.angleDeg, `${field}.angleDeg`, -DEKS_DOCUMENT_LIMITS.maxGradientAngleMagnitude, DEKS_DOCUMENT_LIMITS.maxGradientAngleMagnitude);
}

function identity(value: unknown, index: number): DeksElement {
  const field = `elements[${index}]`;
  const item = record(value, field);
  exactKeys(item, new Set(["id", "kind", "name", "shapeKind", "semanticRole", "parentId", "isLocked"]), field);
  id(item.id, `${field}.id`);
  choice(item.kind, KINDS, `${field}.kind`);
  text(item.name, `${field}.name`, DEKS_DOCUMENT_LIMITS.maxNameCodePoints);
  bool(item.isLocked, `${field}.isLocked`);
  if (item.semanticRole !== undefined) text(item.semanticRole, `${field}.semanticRole`, DEKS_DOCUMENT_LIMITS.maxSemanticRoleCodePoints);
  if (item.parentId !== undefined) id(item.parentId, `${field}.parentId`);
  if (item.kind === "shape") choice(item.shapeKind, new Set(["rectangle", "ellipse", "line"]), `${field}.shapeKind`);
  else if (item.shapeKind !== undefined) fail(`${field}.shapeKind`, "is only valid for shape identities");
  return item as unknown as DeksElement;
}

function optionalNumber(item: Record<string, unknown>, key: string, field: string, min: number, max: number): void {
  if (item[key] !== undefined) numberValue(item[key], `${field}.${key}`, min, max);
}

function cornerRadii(value: unknown, field: string): void {
  const item = record(value, field);
  const keys = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;
  exactKeys(item, new Set(keys), field);
  if (Object.keys(item).length !== keys.length) fail(field, "must define all four corners");
  for (const key of keys) numberValue(item[key], `${field}.${key}`, 0, DEKS_DOCUMENT_LIMITS.maxCornerRadius);
}

function state(value: unknown, element: DeksElement, field: string): DeksElementState {
  const kind = element.kind;
  const item = record(value, field);
  exactKeys(item, STATE_KEYS[kind], field);
  id(item.elementId, `${field}.elementId`);
  numberValue(item.x, `${field}.x`, -DEKS_DOCUMENT_LIMITS.maxGeometryCoordinateMagnitude, DEKS_DOCUMENT_LIMITS.maxGeometryCoordinateMagnitude);
  numberValue(item.y, `${field}.y`, -DEKS_DOCUMENT_LIMITS.maxGeometryCoordinateMagnitude, DEKS_DOCUMENT_LIMITS.maxGeometryCoordinateMagnitude);
  numberValue(item.width, `${field}.width`, DEKS_DOCUMENT_LIMITS.minGeometrySize, DEKS_DOCUMENT_LIMITS.maxGeometrySize);
  numberValue(item.height, `${field}.height`, DEKS_DOCUMENT_LIMITS.minGeometrySize, DEKS_DOCUMENT_LIMITS.maxGeometrySize);
  numberValue(item.rotationDeg, `${field}.rotationDeg`, -DEKS_DOCUMENT_LIMITS.maxRotationMagnitude, DEKS_DOCUMENT_LIMITS.maxRotationMagnitude);
  numberValue(item.opacity, `${field}.opacity`, DEKS_DOCUMENT_LIMITS.minOpacity, DEKS_DOCUMENT_LIMITS.maxOpacity);
  integer(item.zIndex, `${field}.zIndex`, -DEKS_DOCUMENT_LIMITS.maxZIndexMagnitude, DEKS_DOCUMENT_LIMITS.maxZIndexMagnitude);
  for (const key of ["fill", "stroke", "textColor"] as const) if (item[key] !== undefined) color(item[key], `${field}.${key}`);
  optionalNumber(item, "fontSize", field, DEKS_DOCUMENT_LIMITS.minFontSize, DEKS_DOCUMENT_LIMITS.maxFontSize);
  if (item.fontWeight !== undefined) integer(item.fontWeight, `${field}.fontWeight`, DEKS_DOCUMENT_LIMITS.minFontWeight, DEKS_DOCUMENT_LIMITS.maxFontWeight);
  optionalNumber(item, "lineHeight", field, DEKS_DOCUMENT_LIMITS.minLineHeight, DEKS_DOCUMENT_LIMITS.maxLineHeight);
  optionalNumber(item, "letterSpacing", field, -DEKS_DOCUMENT_LIMITS.maxLetterSpacingMagnitude, DEKS_DOCUMENT_LIMITS.maxLetterSpacingMagnitude);
  optionalNumber(item, "strokeWidth", field, 0, DEKS_DOCUMENT_LIMITS.maxStrokeWidth);
  optionalNumber(item, "cornerRadius", field, 0, DEKS_DOCUMENT_LIMITS.maxCornerRadius);
  if (item.cornerRadii !== undefined) cornerRadii(item.cornerRadii, `${field}.cornerRadii`);
  if (item.content !== undefined) text(item.content, `${field}.content`, DEKS_DOCUMENT_LIMITS.maxTextLength, true);
  if (item.alt !== undefined) text(item.alt, `${field}.alt`, DEKS_DOCUMENT_LIMITS.maxAltTextCodePoints, true);
  if (item.label !== undefined) text(item.label, `${field}.label`, DEKS_DOCUMENT_LIMITS.maxLabelCodePoints, true);
  if (item.assetId !== undefined) id(item.assetId, `${field}.assetId`);
  if (kind === "link-button" && item.url !== undefined
    && (typeof item.url !== "string" || [...item.url].length > DEKS_DOCUMENT_LIMITS.maxUrlCodePoints || !isHttpsUrl(item.url))) fail(`${field}.url`, `must be absolute HTTPS with at most ${DEKS_DOCUMENT_LIMITS.maxUrlCodePoints} code points`);
  if (kind === "icon") {
    if (item.iconFamily !== undefined) choice(item.iconFamily, new Set(["lucide"]), `${field}.iconFamily`);
    if (item.iconName !== undefined) text(item.iconName, `${field}.iconName`, DEKS_DOCUMENT_LIMITS.maxIconNameCodePoints);
    if (item.strokeWidth !== undefined) numberValue(item.strokeWidth, `${field}.strokeWidth`, DEKS_DOCUMENT_LIMITS.minIconStrokeWidth, DEKS_DOCUMENT_LIMITS.maxIconStrokeWidth);
  }
  if (item.shapeFill !== undefined) background(item.shapeFill, `${field}.shapeFill`);
  if (kind === "shape" && element.shapeKind !== "rectangle" && item.cornerRadii !== undefined) {
    fail(`${field}.cornerRadii`, "is only valid for rectangle shapes");
  }
  if (kind === "shape" && element.shapeKind === "line" && record(item.shapeFill, `${field}.shapeFill`).kind !== "solid") {
    fail(`${field}.shapeFill`, "must be solid for line shapes");
  }
  if (item.fontFamily !== undefined) choice(item.fontFamily, new Set(["Poppins", "Roboto"]), `${field}.fontFamily`);
  if (item.horizontalAlignment !== undefined) choice(item.horizontalAlignment, new Set(["left", "center", "right", "justify"]), `${field}.horizontalAlignment`);
  if (item.verticalAlignment !== undefined) choice(item.verticalAlignment, new Set(["top", "middle", "bottom"]), `${field}.verticalAlignment`);
  if (item.overflowMode !== undefined) choice(item.overflowMode, new Set(["visible", "hidden", "clip"]), `${field}.overflowMode`);
  if (item.fit !== undefined) choice(item.fit, new Set(["contain", "cover", "fill"]), `${field}.fit`);
  const requiredByKind: Record<DeksElementKind, readonly string[]> = {
    text: ["content", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "horizontalAlignment", "verticalAlignment", "overflowMode", "fill"],
    shape: ["shapeFill", "stroke", "strokeWidth"],
    image: ["assetId", "alt", "fit"],
    group: [],
    "link-button": ["label", "url", "fill", "textColor", "fontFamily", "fontSize", "fontWeight", "cornerRadius", "stroke", "strokeWidth"],
    icon: ["iconFamily", "iconName", "fill", "strokeWidth"],
  };
  for (const key of requiredByKind[kind]) if (item[key] === undefined) fail(`${field}.${key}`, `is required for ${kind} states`);
  return item as unknown as DeksElementState;
}

function slide(value: unknown, index: number, identities: ReadonlyMap<string, DeksElement>): DeksSlide {
  const field = `slides[${index}]`;
  const item = record(value, field);
  exactKeys(item, new Set(["id", "name", "isTemplate", "background", "inPreset", "outPreset", "inDurationMultiplier", "outDurationMultiplier", "states"]), field);
  id(item.id, `${field}.id`);
  text(item.name, `${field}.name`, DEKS_DOCUMENT_LIMITS.maxNameCodePoints);
  bool(item.isTemplate, `${field}.isTemplate`);
  background(item.background, `${field}.background`);
  choice(item.inPreset, PRESETS, `${field}.inPreset`);
  choice(item.outPreset, PRESETS, `${field}.outPreset`);
  choice(item.inDurationMultiplier, RATIOS, `${field}.inDurationMultiplier`);
  choice(item.outDurationMultiplier, RATIOS, `${field}.outDurationMultiplier`);
  if (!Array.isArray(item.states) || item.states.length > DEKS_DOCUMENT_LIMITS.maxStatesPerSlide) fail(`${field}.states`);
  const seen = new Set<string>();
  for (let child = 0; child < item.states.length; child += 1) {
    const raw = record(item.states[child], `${field}.states[${child}]`);
    const elementId = id(raw.elementId, `${field}.states[${child}].elementId`);
    const element = identities.get(elementId);
    if (!element) fail(`${field}.states[${child}].elementId`, "does not reference a declared element");
    if (seen.has(elementId)) fail(`${field}.states.elementId`, "contains a duplicate reference");
    seen.add(elementId);
    state(raw, element, `${field}.states[${child}]`);
  }
  return item as unknown as DeksSlide;
}

function validateTransition(value: unknown, index: number, slides: ReadonlyMap<string, Set<string>>): SlideTransition {
  const field = `transitions[${index}]`;
  const item = record(value, field);
  exactKeys(item, new Set(["fromSlideId", "toSlideId", "motionBeatMs", "durationMultiplier", "effectiveDurationMs", "delayMs", "easing", "bezier", "overrides", "elementMotions"]), field);
  const from = id(item.fromSlideId, `${field}.fromSlideId`);
  const to = id(item.toSlideId, `${field}.toSlideId`);
  const fromElements = slides.get(from);
  const toElements = slides.get(to);
  if (!fromElements || !toElements) fail(`${field}.slideId`, "references a missing slide");
  const beat = integer(item.motionBeatMs, `${field}.motionBeatMs`, DEKS_DOCUMENT_LIMITS.minMotionBeatMs, DEKS_DOCUMENT_LIMITS.maxMotionBeatMs);
  choice(item.durationMultiplier, RATIOS, `${field}.durationMultiplier`);
  const ratio = item.durationMultiplier as number;
  const effective = integer(item.effectiveDurationMs, `${field}.effectiveDurationMs`, 0, DEKS_DOCUMENT_LIMITS.maxEffectiveDurationMs);
  if (effective !== calculateEffectiveDurationMs(beat, ratio)) fail(`${field}.effectiveDurationMs`, "must match motionBeatMs and durationMultiplier");
  integer(item.delayMs, `${field}.delayMs`, 0, DEKS_DOCUMENT_LIMITS.maxTransitionDelayMs);
  choice(item.easing, new Set(["linear", "ease-in", "ease-out", "ease-in-out", "cubic-bezier"]), `${field}.easing`);
  if (item.easing === "cubic-bezier") {
    if (!Array.isArray(item.bezier) || item.bezier.length !== 4) fail(`${field}.bezier`);
    item.bezier.forEach((part, child) => numberValue(part, `${field}.bezier[${child}]`, child % 2 === 0 ? DEKS_DOCUMENT_LIMITS.minBezierX : -DEKS_DOCUMENT_LIMITS.maxBezierYMagnitude, child % 2 === 0 ? DEKS_DOCUMENT_LIMITS.maxBezierX : DEKS_DOCUMENT_LIMITS.maxBezierYMagnitude));
  } else if (item.bezier !== undefined) fail(`${field}.bezier`, "is only valid with cubic-bezier easing");
  const endpointIds = new Set([...fromElements, ...toElements]);
  if (item.overrides !== undefined) {
    if (!Array.isArray(item.overrides) || item.overrides.length > DEKS_DOCUMENT_LIMITS.maxOverridesPerTransition) fail(`${field}.overrides`);
    const seen = new Set<string>();
    item.overrides.forEach((raw, child) => {
      const override = record(raw, `${field}.overrides[${child}]`);
      exactKeys(override, new Set(["elementId", "animate", "durationMultiplier", "delayMs"]), `${field}.overrides[${child}]`);
      const elementId = id(override.elementId, `${field}.overrides[${child}].elementId`);
      if (!endpointIds.has(elementId)) fail(`${field}.overrides[${child}].elementId`, "is absent from the transition endpoints");
      if (seen.has(elementId)) fail(`${field}.overrides`, "contains a duplicate elementId");
      seen.add(elementId);
      bool(override.animate, `${field}.overrides[${child}].animate`);
      if (override.durationMultiplier !== undefined) choice(override.durationMultiplier, RATIOS, `${field}.overrides[${child}].durationMultiplier`);
      if (override.delayMs !== undefined) integer(override.delayMs, `${field}.overrides[${child}].delayMs`, 0, DEKS_DOCUMENT_LIMITS.maxTransitionDelayMs);
    });
  }
  if (item.elementMotions !== undefined) {
    if (!Array.isArray(item.elementMotions) || item.elementMotions.length > DEKS_DOCUMENT_LIMITS.maxElementMotionsPerTransition) fail(`${field}.elementMotions`);
    const seen = new Set<string>();
    item.elementMotions.forEach((raw, child) => {
      const motion = record(raw, `${field}.elementMotions[${child}]`);
      exactKeys(motion, new Set(["elementId", "direction", "preset", "durationMultiplier", "delayMs"]), `${field}.elementMotions[${child}]`);
      const elementId = id(motion.elementId, `${field}.elementMotions[${child}].elementId`);
      choice(motion.direction, new Set(["in", "out"]), `${field}.elementMotions[${child}].direction`);
      const key = `${elementId}:${String(motion.direction)}`;
      if (!endpointIds.has(elementId)) fail(`${field}.elementMotions[${child}].elementId`, "is absent from the transition endpoints");
      if (seen.has(key)) fail(`${field}.elementMotions`, "contains a duplicate motion");
      seen.add(key);
      choice(motion.preset, PRESETS, `${field}.elementMotions[${child}].preset`);
      choice(motion.durationMultiplier, RATIOS, `${field}.elementMotions[${child}].durationMultiplier`);
      integer(motion.delayMs, `${field}.elementMotions[${child}].delayMs`, 0, DEKS_DOCUMENT_LIMITS.maxTransitionDelayMs);
    });
  }
  return item as unknown as SlideTransition;
}

const MAX_STATES_PER_SLIDE = 500;

export const DEKS_DOCUMENT_LIMITS = Object.freeze({
  maxJsonBytes: 5_000_000,
  maxJsonNodes: 200_000,
  maxSlides: 200,
  maxElements: 100_000,
  maxStatesPerSlide: MAX_STATES_PER_SLIDE,
  maxAssets: 10_000,
  maxTransitions: 199,
  maxTextLength: 100_000,
  maxUrlCodePoints: 2_048,
  maxDocumentIdCodePoints: 128,
  maxIdCodePoints: 256,
  maxRevision: Number.MAX_SAFE_INTEGER,
  maxNameCodePoints: 200,
  maxSemanticRoleCodePoints: 100,
  maxMediaTypeCodePoints: 200,
  maxOriginalFilenameCodePoints: 500,
  maxAltTextCodePoints: 2_000,
  maxLabelCodePoints: 200,
  maxIconNameCodePoints: 100,
  minCanvasWidth: 320,
  minCanvasHeight: 180,
  maxCanvasDimension: 16_384,
  maxCanvasAspectRatio: 4,
  maxGeometryCoordinateMagnitude: 100_000,
  minGeometrySize: 0.1,
  maxGeometrySize: 100_000,
  maxRotationMagnitude: 36_000,
  minOpacity: 0,
  maxOpacity: 1,
  maxZIndexMagnitude: 100_000,
  maxGradientAngleMagnitude: 3_600,
  maxCornerRadius: 100_000,
  minFontSize: 0.1,
  maxFontSize: 10_000,
  minFontWeight: 1,
  maxFontWeight: 1_000,
  minLineHeight: 0.1,
  maxLineHeight: 100,
  maxLetterSpacingMagnitude: 1_000,
  maxStrokeWidth: 1_000,
  minIconStrokeWidth: 0.5,
  maxIconStrokeWidth: 8,
  minMotionBeatMs: 50,
  maxMotionBeatMs: 60_000,
  maxTransitionDelayMs: 60_000,
  maxEffectiveDurationMs: 120_000,
  minBezierX: 0,
  maxBezierX: 1,
  maxBezierYMagnitude: 100,
  maxOverridesPerTransition: MAX_STATES_PER_SLIDE * 2,
  maxElementMotionsPerTransition: MAX_STATES_PER_SLIDE * 4,
  maxNestingDepth: 128,
});

/** Cross-runtime half-up rounding for positive transition durations. */
export function calculateEffectiveDurationMs(motionBeatMs: number, durationMultiplier: number): number {
  return Math.floor(motionBeatMs * durationMultiplier + 0.5);
}

function scanJsonLexically(serialized: string): void {
  let offset = 0;
  let nodes = 0;
  const whitespace = () => { while (/\s/u.test(serialized[offset] ?? "")) offset += 1; };
  const stringValue = (decode: boolean): string => {
    let decoded = "";
    offset += 1;
    while (offset < serialized.length) {
      const token = serialized[offset]!;
      if (token === "\\") {
        offset += 1;
        const escape = serialized[offset];
        if (escape === undefined) fail("JSON");
        const simpleEscapes: Record<string, string> = {
          "\"": "\"", "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t",
        };
        if (escape === "u") {
          const hex = serialized.slice(offset + 1, offset + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(hex)) fail("JSON");
          if (decode) decoded += String.fromCharCode(Number.parseInt(hex, 16));
          offset += 5;
          continue;
        }
        if (!(escape in simpleEscapes)) fail("JSON");
        if (decode) decoded += simpleEscapes[escape];
        offset += 1;
        continue;
      }
      if (serialized[offset] === "\"") {
        offset += 1;
        return decoded;
      }
      if (token.charCodeAt(0) < 0x20) fail("JSON");
      if (decode) decoded += token;
      offset += 1;
    }
    fail("JSON");
  };
  const value = (depth: number): void => {
    if (depth > DEKS_DOCUMENT_LIMITS.maxNestingDepth) fail("JSON", "is nested too deeply");
    nodes += 1;
    if (nodes > DEKS_DOCUMENT_LIMITS.maxJsonNodes) {
      fail("JSON", `contains more than ${DEKS_DOCUMENT_LIMITS.maxJsonNodes} nodes`);
    }
    whitespace();
    const token = serialized[offset];
    if (token === "{") {
      offset += 1;
      whitespace();
      const keys = new Set<string>();
      if (serialized[offset] === "}") { offset += 1; return; }
      while (offset < serialized.length) {
        if (serialized[offset] !== "\"") fail("JSON");
        const key = stringValue(true);
        if (keys.has(key)) fail("JSON", `contains duplicate object key ${key}`);
        keys.add(key);
        whitespace();
        if (serialized[offset] !== ":") fail("JSON");
        offset += 1;
        value(depth + 1);
        whitespace();
        if (serialized[offset] === "}") { offset += 1; return; }
        if (serialized[offset] !== ",") fail("JSON");
        offset += 1;
        whitespace();
      }
      fail("JSON");
    }
    if (token === "[") {
      offset += 1;
      whitespace();
      if (serialized[offset] === "]") { offset += 1; return; }
      while (offset < serialized.length) {
        value(depth + 1);
        whitespace();
        if (serialized[offset] === "]") { offset += 1; return; }
        if (serialized[offset] !== ",") fail("JSON");
        offset += 1;
      }
      fail("JSON");
    }
    if (token === "\"") { stringValue(false); return; }
    const start = offset;
    while (offset < serialized.length && !/[\s,\]}]/u.test(serialized[offset]!)) offset += 1;
    if (offset === start) fail("JSON");
  };
  value(0);
  whitespace();
  if (offset !== serialized.length) fail("JSON");
}

export function assertDeksDocument(value: unknown): asserts value is DeksDocument {
  const item = record(value, "root");
  exactKeys(item, new Set(["format", "id", "name", "revision", "canvas", "motionBeatMs", "palette", "history", "assets", "elements", "slides", "transitions"]), "root");
  if (item.format !== "deks") fail("format", "must identify a DEKS document");
  id(item.id, "id", DEKS_DOCUMENT_LIMITS.maxDocumentIdCodePoints);
  text(item.name, "name", DEKS_DOCUMENT_LIMITS.maxNameCodePoints);
  integer(item.revision, "revision", 0, DEKS_DOCUMENT_LIMITS.maxRevision);
  const canvas = record(item.canvas, "canvas");
  exactKeys(canvas, new Set(["width", "height"]), "canvas");
  integer(canvas.width, "canvas.width", DEKS_DOCUMENT_LIMITS.minCanvasWidth, DEKS_DOCUMENT_LIMITS.maxCanvasDimension);
  integer(canvas.height, "canvas.height", DEKS_DOCUMENT_LIMITS.minCanvasHeight, DEKS_DOCUMENT_LIMITS.maxCanvasDimension);
  const aspectRatio = (canvas.width as number) / (canvas.height as number);
  if (aspectRatio > DEKS_DOCUMENT_LIMITS.maxCanvasAspectRatio || aspectRatio < 1 / DEKS_DOCUMENT_LIMITS.maxCanvasAspectRatio) {
    fail("canvas", "aspect ratio must be between 1:4 and 4:1");
  }
  integer(item.motionBeatMs, "motionBeatMs", DEKS_DOCUMENT_LIMITS.minMotionBeatMs, DEKS_DOCUMENT_LIMITS.maxMotionBeatMs);
  const palette = record(item.palette, "palette");
  exactKeys(palette, new Set(["primary", "secondary", "accent", "background", "text", "subtext"]), "palette");
  for (const role of ["primary", "secondary", "accent", "background", "text", "subtext"]) color(palette[role], `palette.${role}`);
  const history = record(item.history, "history");
  exactKeys(history, new Set(["canUndo", "canRedo"]), "history");
  bool(history.canUndo, "history.canUndo");
  bool(history.canRedo, "history.canRedo");
  if (!Array.isArray(item.assets) || item.assets.length > DEKS_DOCUMENT_LIMITS.maxAssets) fail("assets");
  const assets = new Map<string, DeksAssetDescriptor>();
  item.assets.forEach((raw, index) => {
    const field = `assets[${index}]`;
    const asset = record(raw, field);
    exactKeys(asset, new Set(["id", "kind", "url", "mediaType", "originalFilename"]), field);
    const assetId = id(asset.id, `${field}.id`);
    if (assets.has(assetId)) fail("assets.id", "contains a duplicate identity");
    if (asset.kind === "embedded") {
      if (asset.url !== undefined) fail(`${field}.url`, "is not valid for embedded assets");
      text(asset.mediaType, `${field}.mediaType`, DEKS_DOCUMENT_LIMITS.maxMediaTypeCodePoints);
    } else if (asset.kind === "remote") {
      if (typeof asset.url !== "string" || [...asset.url].length > DEKS_DOCUMENT_LIMITS.maxUrlCodePoints || !isHttpsUrl(asset.url)) fail(`${field}.url`, `must be absolute HTTPS with at most ${DEKS_DOCUMENT_LIMITS.maxUrlCodePoints} code points`);
      if (asset.mediaType !== undefined) text(asset.mediaType, `${field}.mediaType`, DEKS_DOCUMENT_LIMITS.maxMediaTypeCodePoints);
    } else fail(`${field}.kind`);
    if (asset.originalFilename !== undefined) text(asset.originalFilename, `${field}.originalFilename`, DEKS_DOCUMENT_LIMITS.maxOriginalFilenameCodePoints);
    assets.set(assetId, asset as unknown as DeksAssetDescriptor);
  });
  if (!Array.isArray(item.elements) || item.elements.length > DEKS_DOCUMENT_LIMITS.maxElements) fail("elements");
  const identities = new Map<string, DeksElement>();
  const identityRecords = new Map<string, DeksElement>();
  item.elements.forEach((raw, index) => {
    const parsed = identity(raw, index);
    if (identities.has(parsed.id)) fail("elements.id", "contains a duplicate identity");
    identities.set(parsed.id, parsed);
    identityRecords.set(parsed.id, parsed);
  });
  for (const element of identityRecords.values()) {
    if (element.parentId === undefined) continue;
    const parent = identityRecords.get(element.parentId);
    if (!parent || parent.kind !== "group") fail(`elements.${element.id}.parentId`, "must reference a declared group");
    const visited = new Set([element.id]);
    let cursor: DeksElement | undefined = parent;
    while (cursor) {
      if (visited.has(cursor.id)) fail(`elements.${element.id}.parentId`, "contains a cycle");
      visited.add(cursor.id);
      cursor = cursor.parentId === undefined ? undefined : identityRecords.get(cursor.parentId);
    }
  }
  if (!Array.isArray(item.slides) || item.slides.length === 0 || item.slides.length > DEKS_DOCUMENT_LIMITS.maxSlides) fail("slides");
  const slideElements = new Map<string, Set<string>>();
  item.slides.forEach((raw, index) => {
    const parsed = slide(raw, index, identities);
    if (slideElements.has(parsed.id)) fail("slides.id", "contains a duplicate id");
    slideElements.set(parsed.id, new Set(parsed.states.map(({ elementId }) => elementId)));
    for (const stateItem of parsed.states) {
      if (identities.get(stateItem.elementId)?.kind === "image" && stateItem.assetId !== undefined && !assets.has(stateItem.assetId)) {
        fail(`slides[${index}].states.${stateItem.elementId}.assetId`, "does not reference a declared asset");
      }
    }
  });
  if (!Array.isArray(item.transitions) || item.transitions.length !== item.slides.length - 1
    || item.transitions.length > DEKS_DOCUMENT_LIMITS.maxTransitions) fail("transitions", "must contain exactly one edge per adjacent slide boundary");
  const slides = item.slides as unknown[];
  const edges = new Set<string>();
  item.transitions.forEach((raw, index) => {
    const parsed = validateTransition(raw, index, slideElements);
    const expectedFrom = (slides[index] as DeksSlide | undefined)?.id;
    const expectedTo = (slides[index + 1] as DeksSlide | undefined)?.id;
    if (parsed.fromSlideId !== expectedFrom || parsed.toSlideId !== expectedTo) {
      fail(`transitions[${index}]`, "must connect consecutive slides in document order");
    }
    const key = `${parsed.fromSlideId}:${parsed.toSlideId}`;
    if (edges.has(key)) fail("transitions", "contains a duplicate edge");
    edges.add(key);
  });
}

export function parseDeksJson(serialized: string): DeksDocument {
  if (new TextEncoder().encode(serialized).byteLength > DEKS_DOCUMENT_LIMITS.maxJsonBytes) fail("JSON", "is too large");
  const value = parseJsonWithUniqueObjectKeys(serialized);
  assertDeksDocument(value);
  return value;
}

export function parseJsonWithUniqueObjectKeys(serialized: string): unknown {
  scanJsonLexically(serialized);
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    fail("JSON");
  }
}

/** Exhaustive structural schema; graph/reference semantics are enforced by assertDeksDocument. */
export const deksDocumentSchema = Object.freeze(schema);

export function isSha256(value: string): boolean {
  return SHA256.test(value);
}
