import type { ElementKind, SlideBackground, SlideTransition } from "./types.js";
import type {
  DeksAssetDescriptor,
  DeksPresentationDocument,
  DeksPresentationElement,
  DeksPresentationElementKind,
  DeksPresentationSlide,
  DeksPresentationState,
} from "./presentation.js";
import { isHttpsUrl, MAX_DEKS_JSON_BYTES } from "./validation.js";

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const RATIOS = new Set([0.5, 0.75, 1, 1.5, 2]);
const PRESETS = new Set(["none", "fade", "glide-top", "glide-right", "glide-bottom", "glide-left"]);
const KINDS = new Set<DeksPresentationElementKind>(["text", "shape", "image", "group", "link-button", "icon"]);
const BASE_STATE_KEYS = ["elementId", "x", "y", "width", "height", "rotationDeg", "opacity", "zIndex"] as const;
const STATE_KEYS: Record<DeksPresentationElementKind, ReadonlySet<string>> = {
  text: new Set([...BASE_STATE_KEYS, "content", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "horizontalAlignment", "verticalAlignment", "overflowMode", "fill", "renderedTextBounds", "measurementSource"]),
  shape: new Set([...BASE_STATE_KEYS, "fill", "shapeFill", "stroke", "strokeWidth", "cornerRadius", "cornerRadii"]),
  image: new Set([...BASE_STATE_KEYS, "assetId", "assetUrl", "alt", "fit"]),
  group: new Set(BASE_STATE_KEYS),
  "link-button": new Set([...BASE_STATE_KEYS, "label", "url", "fill", "textColor", "fontFamily", "fontSize", "fontWeight", "cornerRadius", "stroke", "strokeWidth"]),
  icon: new Set([...BASE_STATE_KEYS, "iconFamily", "iconName", "fill", "strokeWidth"]),
};

function fail(field: string, reason = "is invalid"): never {
  throw new Error(`Invalid DEKS presentation: ${field} ${reason}.`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(field, "must be an object");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) fail(`${field}.${unexpected}`, "is an unknown property");
}

function text(value: unknown, field: string, max = 200, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && value.length === 0)) fail(field);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(field, "contains control characters");
  return value;
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
  numberValue(item.angleDeg, `${field}.angleDeg`, -3600, 3600);
}

function identity(value: unknown, index: number): DeksPresentationElement {
  const field = `elements[${index}]`;
  const item = record(value, field);
  exactKeys(item, new Set(["id", "kind", "name", "shapeKind", "semanticRole", "parentId", "isLocked"]), field);
  text(item.id, `${field}.id`, 256);
  choice(item.kind, KINDS, `${field}.kind`);
  text(item.name, `${field}.name`, 200);
  bool(item.isLocked, `${field}.isLocked`);
  if (item.semanticRole !== undefined) text(item.semanticRole, `${field}.semanticRole`, 100);
  if (item.parentId !== undefined) text(item.parentId, `${field}.parentId`, 256);
  if (item.kind === "shape") choice(item.shapeKind, new Set(["rectangle", "ellipse", "line"]), `${field}.shapeKind`);
  else if (item.shapeKind !== undefined) fail(`${field}.shapeKind`, "is only valid for shape identities");
  return item as unknown as DeksPresentationElement;
}

function optionalNumber(item: Record<string, unknown>, key: string, field: string, min: number, max: number): void {
  if (item[key] !== undefined) numberValue(item[key], `${field}.${key}`, min, max);
}

function cornerRadii(value: unknown, field: string): void {
  const item = record(value, field);
  const keys = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;
  exactKeys(item, new Set(keys), field);
  if (Object.keys(item).length !== keys.length) fail(field, "must define all four corners");
  for (const key of keys) numberValue(item[key], `${field}.${key}`, 0, 100_000);
}

function state(value: unknown, kind: DeksPresentationElementKind, field: string): DeksPresentationState {
  const item = record(value, field);
  exactKeys(item, STATE_KEYS[kind], field);
  text(item.elementId, `${field}.elementId`, 256);
  numberValue(item.x, `${field}.x`, -100_000, 100_000);
  numberValue(item.y, `${field}.y`, -100_000, 100_000);
  numberValue(item.width, `${field}.width`, 0.1, 100_000);
  numberValue(item.height, `${field}.height`, 0.1, 100_000);
  numberValue(item.rotationDeg, `${field}.rotationDeg`, -36_000, 36_000);
  numberValue(item.opacity, `${field}.opacity`, 0, 1);
  integer(item.zIndex, `${field}.zIndex`, -100_000, 100_000);
  for (const key of ["fill", "stroke", "textColor"] as const) if (item[key] !== undefined) color(item[key], `${field}.${key}`);
  optionalNumber(item, "fontSize", field, 0.1, 10_000);
  optionalNumber(item, "fontWeight", field, 1, 1_000);
  optionalNumber(item, "lineHeight", field, 0.1, 100);
  optionalNumber(item, "letterSpacing", field, -1_000, 1_000);
  optionalNumber(item, "strokeWidth", field, 0, 1_000);
  optionalNumber(item, "cornerRadius", field, 0, 100_000);
  if (item.cornerRadii !== undefined) cornerRadii(item.cornerRadii, `${field}.cornerRadii`);
  if (item.content !== undefined) text(item.content, `${field}.content`, 100_000, true);
  if (item.alt !== undefined) text(item.alt, `${field}.alt`, 2_000, true);
  if (item.label !== undefined) text(item.label, `${field}.label`, 200, true);
  if (item.assetId !== undefined) text(item.assetId, `${field}.assetId`, 256);
  if (item.assetUrl !== undefined) fail(`${field}.assetUrl`, "must use an asset registry reference in v2");
  if (kind === "link-button" && item.url !== undefined && (typeof item.url !== "string" || !isHttpsUrl(item.url))) fail(`${field}.url`, "must be absolute HTTPS");
  if (kind === "icon") {
    if (item.iconFamily !== undefined) choice(item.iconFamily, new Set(["lucide"]), `${field}.iconFamily`);
    if (item.iconName !== undefined) text(item.iconName, `${field}.iconName`, 100);
    if (item.strokeWidth !== undefined) numberValue(item.strokeWidth, `${field}.strokeWidth`, 0.5, 8);
  }
  if (item.shapeFill !== undefined) background(item.shapeFill, `${field}.shapeFill`);
  if (item.fontFamily !== undefined) choice(item.fontFamily, new Set(["Poppins", "Roboto"]), `${field}.fontFamily`);
  if (item.horizontalAlignment !== undefined) choice(item.horizontalAlignment, new Set(["left", "center", "right", "justify"]), `${field}.horizontalAlignment`);
  if (item.verticalAlignment !== undefined) choice(item.verticalAlignment, new Set(["top", "middle", "bottom"]), `${field}.verticalAlignment`);
  if (item.overflowMode !== undefined) choice(item.overflowMode, new Set(["visible", "hidden", "clip"]), `${field}.overflowMode`);
  if (item.fit !== undefined) choice(item.fit, new Set(["contain", "cover", "fill"]), `${field}.fit`);
  if (item.measurementSource !== undefined) choice(item.measurementSource, new Set(["estimated", "dom"]), `${field}.measurementSource`);
  if (item.renderedTextBounds !== undefined) {
    const bounds = record(item.renderedTextBounds, `${field}.renderedTextBounds`);
    exactKeys(bounds, new Set(["x", "y", "width", "height"]), `${field}.renderedTextBounds`);
    numberValue(bounds.x, `${field}.renderedTextBounds.x`, -100_000, 100_000);
    numberValue(bounds.y, `${field}.renderedTextBounds.y`, -100_000, 100_000);
    numberValue(bounds.width, `${field}.renderedTextBounds.width`, 0, 100_000);
    numberValue(bounds.height, `${field}.renderedTextBounds.height`, 0, 100_000);
  }
  return item as unknown as DeksPresentationState;
}

function slide(value: unknown, index: number, identities: ReadonlyMap<string, DeksPresentationElementKind>): DeksPresentationSlide {
  const field = `slides[${index}]`;
  const item = record(value, field);
  exactKeys(item, new Set(["id", "name", "isTemplate", "background", "inPreset", "outPreset", "inDurationMultiplier", "outDurationMultiplier", "states"]), field);
  text(item.id, `${field}.id`, 256);
  text(item.name, `${field}.name`, 200);
  bool(item.isTemplate, `${field}.isTemplate`);
  background(item.background, `${field}.background`);
  choice(item.inPreset, PRESETS, `${field}.inPreset`);
  choice(item.outPreset, PRESETS, `${field}.outPreset`);
  choice(item.inDurationMultiplier, RATIOS, `${field}.inDurationMultiplier`);
  choice(item.outDurationMultiplier, RATIOS, `${field}.outDurationMultiplier`);
  if (!Array.isArray(item.states) || item.states.length > 500) fail(`${field}.states`);
  const seen = new Set<string>();
  for (let child = 0; child < item.states.length; child += 1) {
    const raw = record(item.states[child], `${field}.states[${child}]`);
    const elementId = text(raw.elementId, `${field}.states[${child}].elementId`, 256);
    const kind = identities.get(elementId);
    if (!kind) fail(`${field}.states[${child}].elementId`, "does not reference a declared element");
    if (seen.has(elementId)) fail(`${field}.states.elementId`, "contains a duplicate reference");
    seen.add(elementId);
    state(raw, kind, `${field}.states[${child}]`);
  }
  return item as unknown as DeksPresentationSlide;
}

function validateTransition(value: unknown, index: number, slides: ReadonlyMap<string, Set<string>>): SlideTransition {
  const field = `transitions[${index}]`;
  const item = record(value, field);
  exactKeys(item, new Set(["fromSlideId", "toSlideId", "motionBeatMs", "durationMultiplier", "effectiveDurationMs", "delayMs", "easing", "bezier", "overrides", "elementMotions"]), field);
  const from = text(item.fromSlideId, `${field}.fromSlideId`, 256);
  const to = text(item.toSlideId, `${field}.toSlideId`, 256);
  const fromElements = slides.get(from);
  const toElements = slides.get(to);
  if (!fromElements || !toElements) fail(`${field}.slideId`, "references a missing slide");
  const beat = numberValue(item.motionBeatMs, `${field}.motionBeatMs`, 50, 60_000);
  choice(item.durationMultiplier, RATIOS, `${field}.durationMultiplier`);
  const ratio = item.durationMultiplier as number;
  const effective = numberValue(item.effectiveDurationMs, `${field}.effectiveDurationMs`, 0, 120_000);
  if (effective !== beat * ratio) fail(`${field}.effectiveDurationMs`, "must match motionBeatMs and durationMultiplier");
  numberValue(item.delayMs, `${field}.delayMs`, 0, 60_000);
  choice(item.easing, new Set(["linear", "ease-in", "ease-out", "ease-in-out", "cubic-bezier"]), `${field}.easing`);
  if (item.easing === "cubic-bezier") {
    if (!Array.isArray(item.bezier) || item.bezier.length !== 4) fail(`${field}.bezier`);
    item.bezier.forEach((part, child) => numberValue(part, `${field}.bezier[${child}]`, child % 2 === 0 ? 0 : -100, child % 2 === 0 ? 1 : 100));
  } else if (item.bezier !== undefined) fail(`${field}.bezier`, "is only valid with cubic-bezier easing");
  const endpointIds = new Set([...fromElements, ...toElements]);
  if (item.overrides !== undefined) {
    if (!Array.isArray(item.overrides)) fail(`${field}.overrides`);
    const seen = new Set<string>();
    item.overrides.forEach((raw, child) => {
      const override = record(raw, `${field}.overrides[${child}]`);
      exactKeys(override, new Set(["elementId", "animate", "durationMultiplier", "delayMs"]), `${field}.overrides[${child}]`);
      const elementId = text(override.elementId, `${field}.overrides[${child}].elementId`, 256);
      if (!endpointIds.has(elementId)) fail(`${field}.overrides[${child}].elementId`, "is absent from the transition endpoints");
      if (seen.has(elementId)) fail(`${field}.overrides`, "contains a duplicate elementId");
      seen.add(elementId);
      bool(override.animate, `${field}.overrides[${child}].animate`);
      if (override.durationMultiplier !== undefined) choice(override.durationMultiplier, RATIOS, `${field}.overrides[${child}].durationMultiplier`);
      if (override.delayMs !== undefined) numberValue(override.delayMs, `${field}.overrides[${child}].delayMs`, 0, 60_000);
    });
  }
  if (item.elementMotions !== undefined) {
    if (!Array.isArray(item.elementMotions)) fail(`${field}.elementMotions`);
    const seen = new Set<string>();
    item.elementMotions.forEach((raw, child) => {
      const motion = record(raw, `${field}.elementMotions[${child}]`);
      exactKeys(motion, new Set(["elementId", "direction", "preset", "durationMultiplier", "delayMs"]), `${field}.elementMotions[${child}]`);
      const elementId = text(motion.elementId, `${field}.elementMotions[${child}].elementId`, 256);
      choice(motion.direction, new Set(["in", "out"]), `${field}.elementMotions[${child}].direction`);
      const key = `${elementId}:${String(motion.direction)}`;
      if (!endpointIds.has(elementId)) fail(`${field}.elementMotions[${child}].elementId`, "is absent from the transition endpoints");
      if (seen.has(key)) fail(`${field}.elementMotions`, "contains a duplicate motion");
      seen.add(key);
      choice(motion.preset, PRESETS, `${field}.elementMotions[${child}].preset`);
      choice(motion.durationMultiplier, RATIOS, `${field}.elementMotions[${child}].durationMultiplier`);
      numberValue(motion.delayMs, `${field}.elementMotions[${child}].delayMs`, 0, 60_000);
    });
  }
  return item as unknown as SlideTransition;
}

export function assertDeksPresentationDocument(value: unknown): asserts value is DeksPresentationDocument {
  const item = record(value, "root");
  exactKeys(item, new Set(["format", "version", "id", "name", "revision", "canvas", "motionBeatMs", "palette", "history", "assets", "elements", "slides", "transitions"]), "root");
  if (item.format !== "deks" || item.version !== 2) fail("format/version", "must identify DEKS v2");
  text(item.id, "id", 128);
  text(item.name, "name", 200);
  integer(item.revision, "revision", 0, Number.MAX_SAFE_INTEGER);
  const canvas = record(item.canvas, "canvas");
  exactKeys(canvas, new Set(["width", "height"]), "canvas");
  numberValue(canvas.width, "canvas.width", 320, 16_384);
  numberValue(canvas.height, "canvas.height", 180, 16_384);
  numberValue(item.motionBeatMs, "motionBeatMs", 50, 60_000);
  const palette = record(item.palette, "palette");
  exactKeys(palette, new Set(["primary", "secondary", "accent", "background", "text", "subtext"]), "palette");
  for (const role of ["primary", "secondary", "accent", "background", "text", "subtext"]) color(palette[role], `palette.${role}`);
  const history = record(item.history, "history");
  exactKeys(history, new Set(["canUndo", "canRedo"]), "history");
  bool(history.canUndo, "history.canUndo");
  bool(history.canRedo, "history.canRedo");
  if (!Array.isArray(item.assets) || item.assets.length > 10_000) fail("assets");
  const assets = new Map<string, DeksAssetDescriptor>();
  item.assets.forEach((raw, index) => {
    const field = `assets[${index}]`;
    const asset = record(raw, field);
    exactKeys(asset, new Set(["id", "kind", "url", "mediaType", "originalFilename"]), field);
    const id = text(asset.id, `${field}.id`, 256);
    if (assets.has(id)) fail("assets.id", "contains a duplicate identity");
    if (asset.kind === "embedded") {
      if (asset.url !== undefined) fail(`${field}.url`, "is not valid for embedded assets");
      text(asset.mediaType, `${field}.mediaType`, 200);
    } else if (asset.kind === "remote") {
      if (typeof asset.url !== "string" || !isHttpsUrl(asset.url)) fail(`${field}.url`, "must be absolute HTTPS");
      if (asset.mediaType !== undefined) text(asset.mediaType, `${field}.mediaType`, 200);
    } else fail(`${field}.kind`);
    if (asset.originalFilename !== undefined) text(asset.originalFilename, `${field}.originalFilename`, 500);
    assets.set(id, asset as unknown as DeksAssetDescriptor);
  });
  if (!Array.isArray(item.elements) || item.elements.length > 100_000) fail("elements");
  const identities = new Map<string, DeksPresentationElementKind>();
  const identityRecords = new Map<string, DeksPresentationElement>();
  item.elements.forEach((raw, index) => {
    const parsed = identity(raw, index);
    if (identities.has(parsed.id)) fail("elements.id", "contains a duplicate identity");
    identities.set(parsed.id, parsed.kind);
    identityRecords.set(parsed.id, parsed);
  });
  for (const element of identityRecords.values()) {
    if (element.parentId === undefined) continue;
    const parent = identityRecords.get(element.parentId);
    if (!parent || parent.kind !== "group") fail(`elements.${element.id}.parentId`, "must reference a declared group");
    const visited = new Set([element.id]);
    let cursor: DeksPresentationElement | undefined = parent;
    while (cursor) {
      if (visited.has(cursor.id)) fail(`elements.${element.id}.parentId`, "contains a cycle");
      visited.add(cursor.id);
      cursor = cursor.parentId === undefined ? undefined : identityRecords.get(cursor.parentId);
    }
  }
  if (!Array.isArray(item.slides) || item.slides.length === 0 || item.slides.length > 200) fail("slides");
  const slideElements = new Map<string, Set<string>>();
  item.slides.forEach((raw, index) => {
    const parsed = slide(raw, index, identities);
    if (slideElements.has(parsed.id)) fail("slides.id", "contains a duplicate id");
    slideElements.set(parsed.id, new Set(parsed.states.map(({ elementId }) => elementId)));
    for (const stateItem of parsed.states) {
      if (identities.get(stateItem.elementId) === "image" && stateItem.assetId !== undefined && !assets.has(stateItem.assetId)) {
        fail(`slides[${index}].states.${stateItem.elementId}.assetId`, "does not reference a declared asset");
      }
    }
  });
  if (!Array.isArray(item.transitions) || item.transitions.length > 199) fail("transitions");
  const edges = new Set<string>();
  item.transitions.forEach((raw, index) => {
    const parsed = validateTransition(raw, index, slideElements);
    const key = `${parsed.fromSlideId}:${parsed.toSlideId}`;
    if (edges.has(key)) fail("transitions", "contains a duplicate edge");
    edges.add(key);
  });
}

export function parseDeksPresentationJson(serialized: string): DeksPresentationDocument {
  if (new TextEncoder().encode(serialized).byteLength > MAX_DEKS_JSON_BYTES) fail("JSON", "is too large");
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    fail("JSON");
  }
  assertDeksPresentationDocument(value);
  return value;
}

/** JSON Schema discovery metadata. Semantic identity/reference rules are enforced by the parser. */
export const deksPresentationSchema = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://deks.eigen.cl/schemas/presentation-v2.schema.json",
  title: "DEKS Presentation v2",
  type: "object",
  additionalProperties: false,
  required: ["format", "version", "id", "name", "revision", "canvas", "motionBeatMs", "palette", "history", "assets", "elements", "slides", "transitions"],
  properties: {
    format: { const: "deks" },
    version: { const: 2 },
    id: { type: "string", minLength: 1, maxLength: 128 },
    name: { type: "string", minLength: 1, maxLength: 200 },
    revision: { type: "integer", minimum: 0 },
    canvas: { type: "object", additionalProperties: false, required: ["width", "height"], properties: { width: { type: "number", minimum: 320, maximum: 16_384 }, height: { type: "number", minimum: 180, maximum: 16_384 } } },
    motionBeatMs: { type: "number", minimum: 50, maximum: 60_000 },
    palette: {
      type: "object",
      additionalProperties: false,
      required: ["primary", "secondary", "accent", "background", "text", "subtext"],
      properties: Object.fromEntries(["primary", "secondary", "accent", "background", "text", "subtext"].map((role) => [role, { type: "string", pattern: COLOR.source }])),
    },
    history: {
      type: "object",
      additionalProperties: false,
      required: ["canUndo", "canRedo"],
      properties: { canUndo: { type: "boolean" }, canRedo: { type: "boolean" } },
    },
    assets: { type: "array", maxItems: 10_000 },
    elements: { type: "array", maxItems: 100_000 },
    slides: { type: "array", minItems: 1, maxItems: 200 },
    transitions: { type: "array", maxItems: 199 },
  },
} as const);

export function isSha256(value: string): boolean {
  return SHA256.test(value);
}
