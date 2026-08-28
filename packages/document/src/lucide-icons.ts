import { icons as officialLucideIcons } from "@lucide/icons";

export type LucideSvgTag = "path" | "circle" | "ellipse" | "line" | "polyline" | "polygon" | "rect";
export type LucideSvgAttribute =
  | "d" | "cx" | "cy" | "r" | "rx" | "ry" | "x" | "y"
  | "x1" | "x2" | "y1" | "y2" | "width" | "height" | "points"
  | "fill" | "fill-rule" | "clip-rule" | "stroke" | "stroke-width"
  | "stroke-linecap" | "stroke-linejoin" | "opacity";
export type LucideIconNode = readonly [LucideSvgTag, Readonly<Partial<Record<LucideSvgAttribute, string>>>];
export interface LucideIconData {
  readonly name: string;
  readonly nodes: readonly LucideIconNode[];
  readonly width: number;
  readonly height: number;
}

const SAFE_TAGS = new Set<LucideSvgTag>([
  "path", "circle", "ellipse", "line", "polyline", "polygon", "rect",
]);
const SAFE_ATTRIBUTES = new Set<LucideSvgAttribute>([
  "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2",
  "width", "height", "points", "fill", "fill-rule", "clip-rule", "stroke",
  "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity",
]);
const CAMEL_ATTRIBUTES: Readonly<Record<string, LucideSvgAttribute>> = {
  fillRule: "fill-rule",
  clipRule: "clip-rule",
  strokeWidth: "stroke-width",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeAttributeName(name: string): LucideSvgAttribute | undefined {
  if (SAFE_ATTRIBUTES.has(name as LucideSvgAttribute)) return name as LucideSvgAttribute;
  return CAMEL_ATTRIBUTES[name];
}

function sanitizeNodes(value: unknown, iconName: string): readonly LucideIconNode[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`Lucide icon ${iconName} has no SVG nodes`);
  return Object.freeze(value.map((candidate, index) => {
    if (!Array.isArray(candidate) || candidate.length !== 2 || !SAFE_TAGS.has(candidate[0] as LucideSvgTag)) {
      throw new Error(`Lucide icon ${iconName} node ${index} uses an unsupported SVG tag`);
    }
    if (!record(candidate[1])) throw new Error(`Lucide icon ${iconName} node ${index} attributes are invalid`);
    const attributes: Partial<Record<LucideSvgAttribute, string>> = {};
    for (const [rawName, rawValue] of Object.entries(candidate[1])) {
      // `key` is renderer metadata in upstream icon nodes, never an SVG attribute.
      if (rawName === "key") continue;
      const name = normalizeAttributeName(rawName);
      if (!name || (typeof rawValue !== "string" && typeof rawValue !== "number")) {
        throw new Error(`Lucide icon ${iconName} node ${index} uses an unsupported SVG attribute`);
      }
      if (typeof rawValue === "number" && !Number.isFinite(rawValue)) {
        throw new Error(`Lucide icon ${iconName} node ${index} has a non-finite SVG attribute`);
      }
      attributes[name] = String(rawValue);
    }
    return Object.freeze([candidate[0] as LucideSvgTag, Object.freeze(attributes)] as const);
  }));
}

function normalizeIcon(value: unknown): LucideIconData | undefined {
  if (!record(value) || typeof value.name !== "string" || !Array.isArray(value.node)) return undefined;
  const width = typeof value.width === "number" ? value.width : value.size;
  const height = typeof value.height === "number" ? value.height : value.size;
  if (typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width)
    || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Lucide icon ${value.name} has invalid dimensions`);
  }
  return Object.freeze({ name: value.name, nodes: sanitizeNodes(value.node, value.name), width, height });
}

const icons = new Map<string, LucideIconData>();
for (const exported of Object.values(officialLucideIcons)) {
  const icon = normalizeIcon(exported);
  if (icon && !icons.has(icon.name)) icons.set(icon.name, icon);
}
if (icons.size === 0) throw new Error("The pinned @lucide/icons package exported no icon data");

export const lucideIconNames: readonly string[] = Object.freeze([...icons.keys()].sort());

export function isLucideIconName(name: string): boolean {
  return icons.has(name);
}

export function getLucideIconData(name: string): LucideIconData {
  const icon = icons.get(name);
  if (!icon) throw new Error(`Unknown bundled Lucide icon: ${name}`);
  return icon;
}
