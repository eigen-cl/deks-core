import type { Palette } from "./types.js";
import type { LucideIconNode } from "./lucide-icons.js";

export interface IconFamilyDescriptor {
  id: string;
  label: string;
  license: string;
  viewBox: string;
  defaultFill: "none";
  defaultStrokeLinecap: "round";
  defaultStrokeLinejoin: "round";
}

export interface IconDefinition {
  name: string;
  label: string;
  tags: string[];
  /** Trusted primitive geometry from a bundled family. Never a URL or arbitrary SVG markup. */
  nodes: LucideIconNode[];
}

export interface IconCatalog {
  family: IconFamilyDescriptor;
  availableFamilies: Pick<IconFamilyDescriptor, "id" | "label" | "license">[];
  icons: IconDefinition[];
}

export interface ContrastCheck {
  pair:
    | "text/background" | "subtext/background" | "primary/background"
    | "onPrimary/primary" | "onSecondary/secondary" | "onAccent/accent";
  ratio: number;
  threshold: 3 | 4.5;
  passes: boolean;
}

export interface PaletteRecommendation {
  id: string;
  label: string;
  mode: "dark" | "light";
  flavor: string;
  matchedTags: string[];
  roles: Palette;
  onColors: { onPrimary: string; onSecondary: string; onAccent: string };
  contrastChecks: ContrastCheck[];
}

const HEX = /^#[0-9a-f]{6}$/i;
const VIEW_BOX = /^-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?){3}$/;
const ICON_TAGS = new Set(["path", "circle", "ellipse", "line", "polyline", "polygon", "rect"]);
const ICON_ATTRIBUTES = new Set([
  "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2",
  "width", "height", "points", "fill", "fill-rule", "clip-rule", "stroke",
  "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity",
]);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isIconCatalog(value: unknown): value is IconCatalog {
  if (!record(value) || !record(value.family) || !Array.isArray(value.availableFamilies) || !Array.isArray(value.icons)) return false;
  const family = value.family;
  if (
    typeof family.id !== "string" || typeof family.label !== "string" || typeof family.license !== "string"
    || typeof family.viewBox !== "string" || !VIEW_BOX.test(family.viewBox)
    || family.defaultFill !== "none" || family.defaultStrokeLinecap !== "round"
    || family.defaultStrokeLinejoin !== "round"
  ) return false;
  return value.icons.every((candidate) => {
    if (!record(candidate) || typeof candidate.name !== "string" || typeof candidate.label !== "string") return false;
    if (!Array.isArray(candidate.tags) || !candidate.tags.every((tag) => typeof tag === "string")) return false;
    return Array.isArray(candidate.nodes) && candidate.nodes.length > 0
      && candidate.nodes.every((node) => Array.isArray(node) && node.length === 2
        && ICON_TAGS.has(node[0]) && record(node[1])
        && Object.entries(node[1]).every(([name, item]) => ICON_ATTRIBUTES.has(name) && typeof item === "string"));
  });
}

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

export function contrastRatio(first: string, second: string): number {
  if (!HEX.test(first) || !HEX.test(second)) throw new Error("Contrast colors must use #RRGGBB.");
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

export function isPaletteRecommendation(value: unknown): value is PaletteRecommendation {
  if (!record(value) || typeof value.id !== "string" || typeof value.label !== "string") return false;
  if ((value.mode !== "dark" && value.mode !== "light") || typeof value.flavor !== "string" || !record(value.roles)) return false;
  if (!Array.isArray(value.matchedTags) || !value.matchedTags.every((tag) => typeof tag === "string")) return false;
  const roles = value.roles;
  if (!["primary", "secondary", "accent", "background", "text", "subtext"].every((role) => (
    typeof roles[role] === "string" && HEX.test(roles[role])
  ))) return false;
  if (!record(value.onColors)) return false;
  const onColors = value.onColors;
  if (!["onPrimary", "onSecondary", "onAccent"].every((role) => (
    typeof onColors[role] === "string" && HEX.test(onColors[role])
  ))) return false;
  if (!Array.isArray(value.contrastChecks) || value.contrastChecks.length === 0) return false;
  return value.contrastChecks.every((check) => record(check)
    && typeof check.ratio === "number" && Number.isFinite(check.ratio)
    && typeof check.threshold === "number" && check.ratio >= check.threshold && check.passes === true);
}
