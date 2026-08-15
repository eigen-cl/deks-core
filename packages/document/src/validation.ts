import type {
  DeksDocument,
  ElementState,
  HttpsUrl,
  Slide,
  SlideBackground,
  SlideTransition,
} from "./types.js";

export const MAX_DEKS_JSON_BYTES = 5_000_000;
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SAFE_RASTER = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+=*$/i;
const SAFE_BUNDLED = /^\/brand\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|gif|webp|svg)$/i;
const PRESETS = new Set(["none", "fade", "glide-top", "glide-right", "glide-bottom", "glide-left"]);
const RATIOS = new Set([0.5, 0.75, 1, 1.5, 2]);
const LUCIDE_ICONS = new Set([
  "bot", "building-2", "cloud", "database", "eye", "file-text", "laptop",
  "lock-keyhole", "network", "plug", "shield-check", "triangle-alert", "user-round", "workflow",
]);

function fail(field: string): never {
  throw new Error(`Documento DEKS inválido: ${field}.`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(field);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, allowEmpty = false, max = 100_000): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > max) fail(field);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(field);
  return value;
}

function number(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(field);
  return value;
}

function integer(value: unknown, field: string, min: number, max: number): number {
  const parsed = number(value, field, min, max);
  if (!Number.isInteger(parsed)) fail(field);
  return parsed;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail(field);
  return value;
}

function color(value: unknown, field: string): string {
  const parsed = text(value, field, false, 9);
  if (!COLOR.test(parsed)) fail(field);
  return parsed;
}

function choice(value: unknown, values: ReadonlySet<unknown>, field: string): void {
  if (!values.has(value)) fail(field);
}

function background(value: unknown, field: string): void {
  const item = record(value, field) as SlideBackground;
  if (item.kind === "solid") {
    color(item.color, `${field}.color`);
    return;
  }
  if (item.kind !== "linear-gradient") fail(`${field}.kind`);
  color(item.startColor, `${field}.startColor`);
  color(item.endColor, `${field}.endColor`);
  number(item.angleDeg, `${field}.angleDeg`, -3600, 3600);
}

export function isHttpsUrl(value: string): value is HttpsUrl {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function asHttpsUrl(value: string): HttpsUrl {
  if (!isHttpsUrl(value)) fail("url");
  return value as HttpsUrl;
}

function element(value: unknown, field: string): ElementState {
  const item = record(value, field) as unknown as ElementState;
  text(item.id, `${field}.id`, false, 128);
  choice(item.kind, new Set(["text", "shape", "image", "group", "link-button", "icon"]), `${field}.kind`);
  text(item.name, `${field}.name`, false, 200);
  number(item.x, `${field}.x`, -100_000, 100_000);
  number(item.y, `${field}.y`, -100_000, 100_000);
  number(item.width, `${field}.width`, 0.1, 100_000);
  number(item.height, `${field}.height`, 0.1, 100_000);
  number(item.rotationDeg, `${field}.rotationDeg`, -36_000, 36_000);
  number(item.opacity, `${field}.opacity`, 0, 1);
  integer(item.zIndex, `${field}.zIndex`, -100_000, 100_000);
  if (item.kind === "text") {
    text(item.content ?? "", `${field}.content`, true);
    if (item.fill !== undefined) color(item.fill, `${field}.fill`);
  }
  if (item.kind === "shape") {
    choice(item.shapeKind ?? "rectangle", new Set(["rectangle", "ellipse", "line"]), `${field}.shapeKind`);
    if (item.fill !== undefined) color(item.fill, `${field}.fill`);
    if (item.shapeFill !== undefined) background(item.shapeFill, `${field}.shapeFill`);
  }
  if (item.kind === "image" && item.assetUrl) {
    if (!SAFE_RASTER.test(item.assetUrl) && !SAFE_BUNDLED.test(item.assetUrl)) fail(`${field}.assetUrl`);
  }
  if (item.kind === "link-button") {
    text(item.label, `${field}.label`, false, 200);
    if (!item.url || !isHttpsUrl(item.url)) fail(`${field}.url`);
    color(item.fill, `${field}.fill`);
    color(item.textColor, `${field}.textColor`);
  }
  if (item.kind === "icon") {
    choice(item.iconFamily, new Set(["lucide"]), `${field}.iconFamily`);
    choice(item.iconName, LUCIDE_ICONS, `${field}.iconName`);
    color(item.fill, `${field}.fill`);
    number(item.strokeWidth, `${field}.strokeWidth`, 0.5, 8);
  }
  return item;
}

function slide(value: unknown, index: number): Slide {
  const field = `slides[${index}]`;
  const item = record(value, field) as unknown as Slide;
  text(item.id, `${field}.id`, false, 128);
  text(item.name, `${field}.name`, false, 200);
  bool(item.isTemplate, `${field}.isTemplate`);
  background(item.background, `${field}.background`);
  choice(item.inPreset, PRESETS, `${field}.inPreset`);
  choice(item.outPreset, PRESETS, `${field}.outPreset`);
  choice(item.inDurationMultiplier, RATIOS, `${field}.inDurationMultiplier`);
  choice(item.outDurationMultiplier, RATIOS, `${field}.outDurationMultiplier`);
  if (!Array.isArray(item.elements) || item.elements.length > 500) fail(`${field}.elements`);
  item.elements.forEach((entry, child) => element(entry, `${field}.elements[${child}]`));
  if (new Set(item.elements.map(({ id }) => id)).size !== item.elements.length) fail(`${field}.elements.id`);
  return item;
}

function transition(value: unknown, index: number): SlideTransition {
  const field = `transitions[${index}]`;
  const item = record(value, field) as unknown as SlideTransition;
  text(item.fromSlideId, `${field}.fromSlideId`, false, 128);
  text(item.toSlideId, `${field}.toSlideId`, false, 128);
  number(item.motionBeatMs, `${field}.motionBeatMs`, 50, 60_000);
  choice(item.durationMultiplier, RATIOS, `${field}.durationMultiplier`);
  number(item.effectiveDurationMs, `${field}.effectiveDurationMs`, 0, 120_000);
  number(item.delayMs, `${field}.delayMs`, 0, 60_000);
  choice(item.easing, new Set(["linear", "ease-in", "ease-out", "ease-in-out", "cubic-bezier"]), `${field}.easing`);
  if (item.easing === "cubic-bezier" && (!item.bezier || item.bezier.length !== 4 || item.bezier.some((part) => !Number.isFinite(part)))) fail(`${field}.bezier`);
  return item;
}

export function assertDeksDocument(value: unknown): asserts value is DeksDocument {
  const item = record(value, "root") as unknown as DeksDocument;
  text(item.id, "id", false, 128);
  text(item.name, "name", false, 200);
  integer(item.revision, "revision", 0, Number.MAX_SAFE_INTEGER);
  number(item.canvasWidth, "canvasWidth", 320, 16_384);
  number(item.canvasHeight, "canvasHeight", 180, 16_384);
  number(item.motionBeatMs, "motionBeatMs", 50, 60_000);
  const palette = record(item.palette, "palette");
  for (const role of ["primary", "secondary", "accent", "background", "text", "subtext"] as const) color(palette[role], `palette.${role}`);
  const history = record(item.history, "history");
  bool(history.canUndo, "history.canUndo");
  bool(history.canRedo, "history.canRedo");
  if (!Array.isArray(item.slides) || item.slides.length === 0 || item.slides.length > 200) fail("slides");
  if (!Array.isArray(item.transitions) || item.transitions.length > 199) fail("transitions");
  const slides = item.slides.map(slide);
  const transitions = item.transitions.map(transition);
  const slideIds = new Set(slides.map(({ id }) => id));
  if (slideIds.size !== slides.length) fail("slides.id");
  const elementIds = new Set(slides.flatMap(({ elements }) => elements.map(({ id }) => id)));
  const edges = new Set<string>();
  for (const edge of transitions) {
    if (!slideIds.has(edge.fromSlideId) || !slideIds.has(edge.toSlideId)) fail("transitions.slideId");
    const key = `${edge.fromSlideId}:${edge.toSlideId}`;
    if (edges.has(key)) fail("transitions.duplicate");
    edges.add(key);
    for (const reference of [...(edge.overrides ?? []), ...(edge.elementMotions ?? [])]) {
      if (!elementIds.has(reference.elementId)) fail("transitions.elementId");
    }
  }
}

export function parseDeksDocumentJson(serialized: string): DeksDocument {
  if (new TextEncoder().encode(serialized).byteLength > MAX_DEKS_JSON_BYTES) throw new Error("El documento DEKS es demasiado grande.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("Documento DEKS inválido: JSON.");
  }
  assertDeksDocument(parsed);
  return parsed;
}
