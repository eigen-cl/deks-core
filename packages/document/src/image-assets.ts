import { SaxesParser, type SaxesTagNS } from "saxes";
import { inspectAndNormalizeDeksAudio } from "./audio-assets.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

export const DEKS_IMAGE_LIMITS = Object.freeze({
  rasterMediaTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] as const,
  svgMediaType: "image/svg+xml" as const,
  maxRasterBytes: 50_000_000,
  maxSvgBytes: 5_000_000,
  maxWidth: 16_384,
  maxHeight: 16_384,
  maxLogicalPixels: 40_000_000,
  maxFrames: 200,
  maxAggregatePixels: 100_000_000,
  maxSvgNodes: 10_000,
  maxSvgDepth: 64,
  maxSvgAttributes: 100_000,
  maxSvgPathCharacters: 2_000_000,
});

export type DeksImageMediaType = (typeof DEKS_IMAGE_LIMITS.rasterMediaTypes)[number]
  | typeof DEKS_IMAGE_LIMITS.svgMediaType;

export interface DeksImageInspection {
  bytes: Uint8Array;
  mediaType: DeksImageMediaType;
  width: number;
  height: number;
}

export type DeksImageErrorCode =
  | "asset_empty"
  | "asset_too_large"
  | "asset_media_type_unsupported"
  | "asset_unsafe"
  | "asset_too_complex";

export class DeksImageError extends Error {
  readonly code: DeksImageErrorCode;

  constructor(code: DeksImageErrorCode, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "DeksImageError";
    this.code = code;
  }
}

export interface DeksImageAssetDescriptorSource {
  assets: ReadonlyArray<{ id: string; kind: string; mediaType?: string }>;
}

export interface NormalizeDeksFileAssetsOptions {
  allowMissing?: boolean;
}

interface SvgNode {
  name: string;
  attributes: Map<string, string>;
  children: Array<SvgNode | string>;
}

const SVG_ELEMENTS = new Set([
  "svg", "g", "defs", "title", "desc", "path", "rect", "circle", "ellipse", "line",
  "polyline", "polygon", "linearGradient", "radialGradient", "stop", "clipPath",
]);

const GLOBAL_ATTRIBUTES = new Set([
  "id", "fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity",
  "fill-rule", "clip-rule", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
  "stroke-dasharray", "stroke-dashoffset", "vector-effect", "transform", "clip-path", "color",
]);

const ELEMENT_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  svg: new Set(["xmlns", "viewBox", "width", "height", "preserveAspectRatio"]),
  g: new Set(),
  defs: new Set(),
  title: new Set(),
  desc: new Set(),
  path: new Set(["d", "pathLength"]),
  rect: new Set(["x", "y", "width", "height", "rx", "ry", "pathLength"]),
  circle: new Set(["cx", "cy", "r", "pathLength"]),
  ellipse: new Set(["cx", "cy", "rx", "ry", "pathLength"]),
  line: new Set(["x1", "y1", "x2", "y2", "pathLength"]),
  polyline: new Set(["points", "pathLength"]),
  polygon: new Set(["points", "pathLength"]),
  linearGradient: new Set(["x1", "y1", "x2", "y2", "gradientUnits", "gradientTransform", "spreadMethod"]),
  radialGradient: new Set(["cx", "cy", "r", "fx", "fy", "fr", "gradientUnits", "gradientTransform", "spreadMethod"]),
  stop: new Set(["offset", "stop-color", "stop-opacity"]),
  clipPath: new Set(["clipPathUnits", "transform"]),
};

const NUMERIC_ATTRIBUTES = new Set([
  "stroke-width", "opacity", "fill-opacity", "stroke-opacity", "stroke-miterlimit",
  "stroke-dashoffset", "pathLength", "x", "y", "width", "height", "rx", "ry", "cx", "cy",
  "r", "x1", "y1", "x2", "y2", "fx", "fy", "fr", "stop-opacity",
]);
const PAINT_ATTRIBUTES = new Set(["fill", "stroke", "color", "stop-color"]);
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const NUMBER_PARTS_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const LENGTH_PATTERN = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(%)?$/;
const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/;
const PATH_PATTERN = /^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]*$/;
const POINTS_PATTERN = /^[0-9eE+.,\s-]*$/;
const SAFE_PAINT_FUNCTION = /^(?:rgb|rgba|hsl|hsla)\([0-9eE+.,%\s-]+\)$/i;
const SAFE_PAINT_NAME = /^[A-Za-z]+$/;
const SAFE_HEX_PAINT = /^#[0-9A-Fa-f]{3,8}$/;
const INTERNAL_REFERENCE = /^url\(#([A-Za-z_][A-Za-z0-9_.:-]{0,127})\)$/;

function failure(message: string): never {
  throw new Error(`invalid DEKS SVG: ${message}`);
}

function finiteNumber(value: string, field: string): number {
  const trimmed = value.trim();
  if (!NUMBER_PATTERN.test(trimmed)) failure(`${field} must be a finite number`);
  const number = Number(trimmed);
  if (!Number.isFinite(number)) failure(`${field} must be a finite number`);
  return Object.is(number, -0) ? 0 : number;
}

function canonicalNumber(value: string, field: string): string {
  const trimmed = value.trim();
  finiteNumber(trimmed, field);
  const match = NUMBER_PARTS_PATTERN.exec(trimmed);
  if (!match) failure(`${field} must be a finite number`);
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 308) failure(`${field} exponent is outside the supported range`);
  const integer = match[2] ?? "";
  const fraction = match[3] ?? "";
  const combined = integer + fraction;
  const leadingZeros = combined.match(/^0*/)?.[0].length ?? 0;
  let digits = combined.slice(leadingZeros);
  if (!digits) return "0";
  const decimalIndex = integer.length + exponent - leadingZeros;
  digits = digits.replace(/0+$/, "");
  let normalized: string;
  if (decimalIndex <= 0) normalized = `0.${"0".repeat(-decimalIndex)}${digits}`;
  else if (decimalIndex >= digits.length) normalized = `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  else normalized = `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  return match[1] === "-" ? `-${normalized}` : normalized;
}

function canonicalLength(value: string, field: string, allowPercentage = true): string {
  const match = LENGTH_PATTERN.exec(value.trim());
  if (!match || (!allowPercentage && match[2])) failure(`${field} must be a finite unitless number${allowPercentage ? " or percentage" : ""}`);
  return `${canonicalNumber(match[1]!, field)}${match[2] ?? ""}`;
}

function rootLength(value: string, field: string): number {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:px)?$/.exec(value.trim());
  if (!match) failure(`${field} must be unitless or px`);
  const result = finiteNumber(match[1]!, field);
  if (result <= 0) failure(`${field} must be positive`);
  return result;
}

function validateDimensions(width: number, height: number, context: string): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`${context} dimensions must be finite and positive`);
  }
  if (width > DEKS_IMAGE_LIMITS.maxWidth || height > DEKS_IMAGE_LIMITS.maxHeight) {
    throw new Error(`${context} dimensions exceed ${DEKS_IMAGE_LIMITS.maxWidth} x ${DEKS_IMAGE_LIMITS.maxHeight}`);
  }
  if (width * height > DEKS_IMAGE_LIMITS.maxLogicalPixels) {
    throw new Error(`${context} exceeds ${DEKS_IMAGE_LIMITS.maxLogicalPixels} logical pixels`);
  }
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")
    .replaceAll("\r", "&#13;").replaceAll("\n", "&#10;").replaceAll("\t", "&#9;");
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\r", "&#13;");
}

function canonicalPaint(value: string, field: string): string {
  const trimmed = value.trim();
  if (INTERNAL_REFERENCE.test(trimmed) || SAFE_HEX_PAINT.test(trimmed) || SAFE_PAINT_NAME.test(trimmed)
    || SAFE_PAINT_FUNCTION.test(trimmed)) return trimmed;
  failure(`${field} contains an unsafe paint`);
}

function canonicalTransform(value: string, field: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || /[^A-Za-z0-9eE+.,()\s-]/.test(trimmed)) failure(`${field} contains an unsafe transform`);
  let remaining = trimmed;
  const normalized: string[] = [];
  const part = /^(matrix|translate|scale|rotate|skewX|skewY)\(\s*([0-9eE+.,\s-]+)\s*\)\s*/;
  while (remaining) {
    const match = part.exec(remaining);
    if (!match) failure(`${field} contains an unsupported transform`);
    const numbers = match[2]!.split(/[\s,]+/).filter(Boolean);
    if (numbers.length === 0) failure(`${field} contains an empty transform`);
    normalized.push(`${match[1]}(${numbers.map((number) => canonicalNumber(number, field)).join(" ")})`);
    remaining = remaining.slice(match[0].length);
  }
  return normalized.join(" ");
}

function canonicalAttribute(element: string, name: string, value: string): string {
  if (element === "svg" && (name === "width" || name === "height")) return value.trim();
  if (name === "id") {
    if (!ID_PATTERN.test(value)) failure("id is invalid");
    return value;
  }
  if (PAINT_ATTRIBUTES.has(name)) return canonicalPaint(value, name);
  if (name === "clip-path") {
    const trimmed = value.trim();
    if (trimmed !== "none" && !INTERNAL_REFERENCE.test(trimmed)) failure("clip-path must be an internal reference");
    return trimmed;
  }
  if (NUMERIC_ATTRIBUTES.has(name)) {
    const normalized = canonicalLength(value, name);
    if (["opacity", "fill-opacity", "stroke-opacity", "stop-opacity"].includes(name)) {
      const number = Number(normalized.replace("%", ""));
      const upper = normalized.endsWith("%") ? 100 : 1;
      if (number < 0 || number > upper) failure(`${name} is outside its range`);
    }
    return normalized;
  }
  if (name === "offset") {
    const normalized = canonicalLength(value, name);
    const number = Number(normalized.replace("%", ""));
    const upper = normalized.endsWith("%") ? 100 : 1;
    if (number < 0 || number > upper) failure("offset is outside its range");
    return normalized;
  }
  if (name === "stroke-dasharray") {
    if (value.trim() === "none") return "none";
    const parts = value.trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length === 0) failure("stroke-dasharray is invalid");
    return parts.map((part) => canonicalLength(part, name)).join(" ");
  }
  if (name === "points") {
    if (!POINTS_PATTERN.test(value)) failure("points is invalid");
    const parts = value.trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length < 2 || parts.length % 2 !== 0) failure("points must contain coordinate pairs");
    return parts.map((part) => canonicalNumber(part, name)).join(" ");
  }
  if (name === "d") {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (!normalized || !PATH_PATTERN.test(normalized)) failure("path data is invalid");
    return normalized;
  }
  if (name === "transform" || name === "gradientTransform") return canonicalTransform(value, name);
  if (name === "fill-rule" || name === "clip-rule") {
    if (value !== "nonzero" && value !== "evenodd") failure(`${name} is invalid`);
    return value;
  }
  if (name === "stroke-linecap") {
    if (!["butt", "round", "square"].includes(value)) failure(`${name} is invalid`);
    return value;
  }
  if (name === "stroke-linejoin") {
    if (!["miter", "round", "bevel"].includes(value)) failure(`${name} is invalid`);
    return value;
  }
  if (name === "vector-effect") {
    if (value !== "none" && value !== "non-scaling-stroke") failure(`${name} is invalid`);
    return value;
  }
  if (name === "gradientUnits" || name === "clipPathUnits") {
    if (value !== "userSpaceOnUse" && value !== "objectBoundingBox") failure(`${name} is invalid`);
    return value;
  }
  if (name === "spreadMethod") {
    if (!["pad", "reflect", "repeat"].includes(value)) failure("spreadMethod is invalid");
    return value;
  }
  if (name === "preserveAspectRatio") {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (!/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(normalized)) failure("preserveAspectRatio is invalid");
    return normalized;
  }
  if (name === "viewBox" || name === "xmlns") return value;
  failure(`${element}.${name} is unsupported`);
}

function serializeSvg(node: SvgNode): string {
  const attributes = [...node.attributes].sort(([left], [right]) => {
    if (left === "xmlns") return -1;
    if (right === "xmlns") return 1;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const opening = `<${node.name}${attributes.map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join("")}`;
  if (node.children.length === 0) return `${opening}/>`;
  return `${opening}>${node.children.map((child) => typeof child === "string" ? escapeText(child) : serializeSvg(child)).join("")}</${node.name}>`;
}

function referenceId(value: string): string | undefined {
  return INTERNAL_REFERENCE.exec(value)?.[1];
}

function validateReferences(root: SvgNode): void {
  const ids = new Map<string, SvgNode>();
  const graph = new Map<string, Set<string>>();
  const walk = (node: SvgNode, resourceId?: string): void => {
    const ownId = node.attributes.get("id");
    if (ownId) {
      if (ids.has(ownId)) failure(`duplicate id ${ownId}`);
      ids.set(ownId, node);
    }
    const currentResource = ["linearGradient", "radialGradient", "clipPath"].includes(node.name) && ownId
      ? ownId : resourceId;
    for (const [name, value] of node.attributes) {
      const target = referenceId(value);
      if (!target) continue;
      const required = name === "clip-path" ? "clipPath" : "gradient";
      const targetNode = ids.get(target);
      // Forward references are checked after the full tree walk.
      const key = `${required}\u0000${target}`;
      const references = graph.get(currentResource ?? "") ?? new Set<string>();
      references.add(key);
      graph.set(currentResource ?? "", references);
      void targetNode;
    }
    for (const child of node.children) if (typeof child !== "string") walk(child, currentResource);
  };
  walk(root);
  for (const references of graph.values()) {
    for (const encoded of references) {
      const [required, target] = encoded.split("\u0000") as [string, string];
      const targetNode = ids.get(target);
      if (!targetNode) failure(`dangling internal reference ${target}`);
      if (required === "clipPath" && targetNode.name !== "clipPath") failure(`reference ${target} must target clipPath`);
      if (required === "gradient" && targetNode.name !== "linearGradient" && targetNode.name !== "radialGradient") {
        failure(`reference ${target} must target a gradient`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) failure(`cyclic internal reference ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const encoded of graph.get(id) ?? []) visit(encoded.split("\u0000")[1]!);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of graph.keys()) if (id) visit(id);
}

export function normalizeDeksSvg(content: Uint8Array): DeksImageInspection {
  if (content.byteLength > DEKS_IMAGE_LIMITS.maxSvgBytes) throw new Error("DEKS SVG is too large");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new Error("invalid DEKS SVG UTF-8");
  }
  const stack: SvgNode[] = [];
  let root: SvgNode | undefined;
  let nodes = 0;
  let attributes = 0;
  let pathCharacters = 0;
  let parseFailure: Error | undefined;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => failure("DOCTYPE and ENTITY declarations are forbidden"));
  parser.on("processinginstruction", () => failure("processing instructions are forbidden"));
  parser.on("cdata", () => failure("CDATA is forbidden"));
  parser.on("opentag", (tag: SaxesTagNS) => {
    nodes += 1;
    if (nodes > DEKS_IMAGE_LIMITS.maxSvgNodes) failure(`contains more than ${DEKS_IMAGE_LIMITS.maxSvgNodes} nodes`);
    if (stack.length + 1 > DEKS_IMAGE_LIMITS.maxSvgDepth) failure(`exceeds depth ${DEKS_IMAGE_LIMITS.maxSvgDepth}`);
    if (tag.prefix || tag.uri !== SVG_NAMESPACE || !SVG_ELEMENTS.has(tag.local)) failure(`element ${tag.name} is unsupported`);
    if (!root && tag.local !== "svg") failure("root element must be svg");
    if (root && tag.local === "svg") failure("nested svg is unsupported");
    const node: SvgNode = { name: tag.local, attributes: new Map(), children: [] };
    const allowed = ELEMENT_ATTRIBUTES[tag.local]!;
    for (const attribute of Object.values(tag.attributes)) {
      attributes += 1;
      if (attributes > DEKS_IMAGE_LIMITS.maxSvgAttributes) failure(`contains more than ${DEKS_IMAGE_LIMITS.maxSvgAttributes} attributes`);
      const name = attribute.name;
      if (name === "xmlns") {
        if (tag.local !== "svg" || root || attribute.uri !== XMLNS_NAMESPACE || attribute.value !== SVG_NAMESPACE) failure("SVG namespace declaration is invalid");
      } else if (attribute.prefix || attribute.uri) {
        failure(`namespaced attribute ${name} is unsupported`);
      }
      if (/^on/i.test(name) || ["style", "class", "xml:base", "href", "xlink:href"].includes(name)) failure(`attribute ${name} is forbidden`);
      if (!GLOBAL_ATTRIBUTES.has(name) && !allowed.has(name)) failure(`attribute ${tag.local}.${name} is unsupported`);
      if (name === "d") {
        pathCharacters += attribute.value.length;
        if (pathCharacters > DEKS_IMAGE_LIMITS.maxSvgPathCharacters) {
          failure(`contains more than ${DEKS_IMAGE_LIMITS.maxSvgPathCharacters} path characters`);
        }
      }
      node.attributes.set(name, canonicalAttribute(tag.local, name, attribute.value));
    }
    if (!root) root = node;
    else stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  parser.on("text", (text) => {
    if (!text) return;
    const current = stack.at(-1);
    if (!current) {
      if (text.trim()) failure("text outside the root element is forbidden");
      return;
    }
    if (current.name !== "title" && current.name !== "desc") {
      if (text.trim()) failure(`text inside ${current.name} is forbidden`);
      return;
    }
    current.children.push(text);
  });
  parser.on("closetag", () => { stack.pop(); });
  parser.on("error", (error) => { parseFailure = error; });
  try {
    parser.write(source).close();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("invalid DEKS SVG:")) throw error;
    throw new Error(`invalid DEKS SVG XML: ${error instanceof Error ? error.message : "parse error"}`);
  }
  if (parseFailure) throw new Error(`invalid DEKS SVG XML: ${parseFailure.message}`);
  if (!root) failure("root element is missing");
  if (root.attributes.get("xmlns") !== SVG_NAMESPACE) failure("root xmlns is required");

  const rawViewBox = root.attributes.get("viewBox");
  let viewBox: [number, number, number, number];
  let canonicalViewBox: string[];
  if (rawViewBox !== undefined) {
    const parts = rawViewBox.trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 4) failure("viewBox must contain four numbers");
    canonicalViewBox = parts.map((part) => canonicalNumber(part, "viewBox"));
    viewBox = parts.map((part) => finiteNumber(part, "viewBox")) as [number, number, number, number];
    if (viewBox[2] <= 0 || viewBox[3] <= 0) failure("viewBox width and height must be positive");
  } else {
    const rawWidth = root.attributes.get("width");
    const rawHeight = root.attributes.get("height");
    if (rawWidth === undefined || rawHeight === undefined) failure("viewBox or width and height are required");
    viewBox = [0, 0, rootLength(rawWidth, "width"), rootLength(rawHeight, "height")];
    canonicalViewBox = ["0", "0", canonicalNumber(rawWidth.trim().replace(/px$/, ""), "width"), canonicalNumber(rawHeight.trim().replace(/px$/, ""), "height")];
  }
  if (root.attributes.has("width")) rootLength(root.attributes.get("width")!, "width");
  if (root.attributes.has("height")) rootLength(root.attributes.get("height")!, "height");
  validateDimensions(viewBox[2], viewBox[3], "DEKS SVG");
  root.attributes.delete("width");
  root.attributes.delete("height");
  root.attributes.set("viewBox", canonicalViewBox.join(" "));
  validateReferences(root);
  const normalized = new TextEncoder().encode(serializeSvg(root));
  return { bytes: normalized, mediaType: "image/svg+xml", width: viewBox[2], height: viewBox[3] };
}

function bigEndian32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function littleEndian16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function littleEndian24(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function littleEndian32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

interface RasterGeometry {
  width: number;
  height: number;
  frames: Array<readonly [number, number]>;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function inspectPng(content: Uint8Array): RasterGeometry {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (content.byteLength < 45 || !signature.every((byte, index) => content[index] === byte)) {
    throw new Error("invalid or truncated PNG signature");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawIdat = false;
  let sawIend = false;
  let declaredFrames: number | undefined;
  const frames: Array<readonly [number, number]> = [];
  while (offset < content.byteLength) {
    if (offset + 12 > content.byteLength) throw new Error("truncated PNG chunk");
    const length = bigEndian32(content, offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > content.byteLength) throw new Error("truncated PNG chunk");
    const type = ascii(content, offset + 4, 4);
    const data = offset + 8;
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) throw new Error("invalid PNG IHDR");
      width = bigEndian32(content, data);
      height = bigEndian32(content, data + 4);
    } else if (type === "IHDR") {
      throw new Error("invalid duplicate PNG IHDR");
    }
    if (type === "acTL") {
      if (length !== 8 || declaredFrames !== undefined) throw new Error("invalid APNG acTL");
      declaredFrames = bigEndian32(content, data);
      if (declaredFrames === 0) throw new Error("invalid APNG frame count");
    } else if (type === "fcTL") {
      if (length !== 26 || declaredFrames === undefined) throw new Error("invalid APNG fcTL");
      const frameWidth = bigEndian32(content, data + 4);
      const frameHeight = bigEndian32(content, data + 8);
      const x = bigEndian32(content, data + 12);
      const y = bigEndian32(content, data + 16);
      if (x + frameWidth > width || y + frameHeight > height) throw new Error("APNG frame dimensions exceed the canvas");
      frames.push([frameWidth, frameHeight]);
    } else if (type === "IDAT") {
      sawIdat = true;
    } else if (type === "IEND") {
      if (length !== 0 || !sawIdat) throw new Error("invalid PNG IEND");
      sawIend = true;
      offset = end;
      break;
    }
    offset = end;
  }
  if (!sawIend) throw new Error("truncated PNG: missing IEND");
  if (offset !== content.byteLength) throw new Error("invalid PNG trailing bytes");
  if (declaredFrames !== undefined && (frames.length !== declaredFrames || frames.length === 0)) {
    throw new Error("invalid APNG frame count");
  }
  return { width, height, frames: frames.length > 0 ? frames : [[width, height]] };
}

function inspectGif(content: Uint8Array): RasterGeometry {
  const signature = content.byteLength >= 13 ? ascii(content, 0, 6) : "";
  if (signature !== "GIF87a" && signature !== "GIF89a") throw new Error("invalid or truncated GIF signature/header");
  const width = littleEndian16(content, 6);
  const height = littleEndian16(content, 8);
  let offset = 13;
  const packed = content[10]!;
  if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1));
  if (offset > content.byteLength) throw new Error("truncated GIF color table");
  const frames: Array<readonly [number, number]> = [];
  const skipSubBlocks = (): void => {
    while (true) {
      if (offset >= content.byteLength) throw new Error("truncated GIF sub-block");
      const length = content[offset++]!;
      if (length === 0) return;
      if (offset + length > content.byteLength) throw new Error("truncated GIF sub-block");
      offset += length;
    }
  };
  while (offset < content.byteLength) {
    const introducer = content[offset++]!;
    if (introducer === 0x3b) {
      if (offset !== content.byteLength) throw new Error("invalid GIF trailing bytes");
      if (frames.length === 0) throw new Error("invalid GIF without image data");
      return { width, height, frames };
    }
    if (introducer === 0x21) {
      if (offset >= content.byteLength) throw new Error("truncated GIF extension");
      offset += 1;
      skipSubBlocks();
      continue;
    }
    if (introducer !== 0x2c || offset + 9 > content.byteLength) throw new Error("invalid or truncated GIF image descriptor");
    const left = littleEndian16(content, offset);
    const top = littleEndian16(content, offset + 2);
    const frameWidth = littleEndian16(content, offset + 4);
    const frameHeight = littleEndian16(content, offset + 6);
    const framePacked = content[offset + 8]!;
    offset += 9;
    if (left + frameWidth > width || top + frameHeight > height) throw new Error("GIF frame dimensions exceed the canvas");
    frames.push([frameWidth, frameHeight]);
    if (framePacked & 0x80) offset += 3 * (1 << ((framePacked & 0x07) + 1));
    if (offset >= content.byteLength) throw new Error("truncated GIF image data");
    offset += 1;
    skipSubBlocks();
  }
  throw new Error("truncated GIF: missing trailer");
}

function inspectJpeg(content: Uint8Array): RasterGeometry {
  if (content.byteLength < 4 || content[0] !== 0xff || content[1] !== 0xd8) throw new Error("invalid JPEG signature");
  let offset = 2;
  let width = 0;
  let height = 0;
  let inScan = false;
  while (offset < content.byteLength) {
    if (inScan) {
      while (offset < content.byteLength && content[offset] !== 0xff) offset += 1;
      if (offset >= content.byteLength) break;
    }
    if (content[offset++] !== 0xff) throw new Error("invalid JPEG marker structure");
    while (offset < content.byteLength && content[offset] === 0xff) offset += 1;
    if (offset >= content.byteLength) break;
    const marker = content[offset++]!;
    if (inScan && marker === 0x00) continue;
    if (marker === 0xd9) {
      if (!width || !height) throw new Error("invalid JPEG dimensions");
      if (offset !== content.byteLength) throw new Error("invalid JPEG trailing bytes");
      return { width, height, frames: [[width, height]] };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    inScan = false;
    if (offset + 2 > content.byteLength) break;
    const length = (content[offset]! << 8) | content[offset + 1]!;
    if (length < 2 || offset + length > content.byteLength) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) throw new Error("invalid JPEG SOF");
      height = (content[offset + 3]! << 8) | content[offset + 4]!;
      width = (content[offset + 5]! << 8) | content[offset + 6]!;
    }
    offset += length;
    if (marker === 0xda) inScan = true;
  }
  throw new Error("truncated JPEG: missing EOI");
}

function inspectWebp(content: Uint8Array): RasterGeometry {
  if (content.byteLength < 20 || ascii(content, 0, 4) !== "RIFF" || ascii(content, 8, 4) !== "WEBP") {
    throw new Error("invalid or truncated WebP signature/header");
  }
  if (littleEndian32(content, 4) + 8 !== content.byteLength) throw new Error("invalid WebP RIFF declared length");
  let offset = 12;
  let width = 0;
  let height = 0;
  let animated = false;
  const frames: Array<readonly [number, number]> = [];
  while (offset < content.byteLength) {
    if (offset + 8 > content.byteLength) throw new Error("truncated WebP chunk");
    const type = ascii(content, offset, 4);
    const length = littleEndian32(content, offset + 4);
    const data = offset + 8;
    const end = data + length;
    const paddedEnd = end + (length & 1);
    if (!Number.isSafeInteger(paddedEnd) || paddedEnd > content.byteLength) throw new Error("truncated WebP chunk");
    if (type === "VP8X") {
      if (length !== 10 || width || height) throw new Error("invalid WebP VP8X header");
      animated = (content[data]! & 0x02) !== 0;
      width = 1 + littleEndian24(content, data + 4);
      height = 1 + littleEndian24(content, data + 7);
    } else if (type === "VP8L") {
      if (length < 5 || content[data] !== 0x2f) throw new Error("invalid WebP VP8L header");
      if (!width) width = 1 + content[data + 1]! + ((content[data + 2]! & 0x3f) << 8);
      if (!height) height = 1 + (content[data + 2]! >> 6) + (content[data + 3]! << 2) + ((content[data + 4]! & 0x0f) << 10);
    } else if (type === "VP8 ") {
      if (length < 10 || content[data + 3] !== 0x9d || content[data + 4] !== 0x01 || content[data + 5] !== 0x2a) {
        throw new Error("invalid WebP VP8 header");
      }
      if (!width) width = littleEndian16(content, data + 6) & 0x3fff;
      if (!height) height = littleEndian16(content, data + 8) & 0x3fff;
    } else if (type === "ANMF") {
      if (length < 16) throw new Error("invalid WebP ANMF chunk");
      const x = littleEndian24(content, data) * 2;
      const y = littleEndian24(content, data + 3) * 2;
      const frameWidth = 1 + littleEndian24(content, data + 6);
      const frameHeight = 1 + littleEndian24(content, data + 9);
      if (width && height && (x + frameWidth > width || y + frameHeight > height)) throw new Error("WebP frame dimensions exceed the canvas");
      frames.push([frameWidth, frameHeight]);
    }
    offset = paddedEnd;
  }
  if (offset !== content.byteLength || !width || !height) throw new Error("invalid or truncated WebP dimensions");
  if (animated !== (frames.length > 0)) throw new Error("invalid WebP animation frame count");
  return { width, height, frames: frames.length > 0 ? frames : [[width, height]] };
}

function rasterGeometry(content: Uint8Array, mediaType: Exclude<DeksImageMediaType, "image/svg+xml">): RasterGeometry {
  if (mediaType === "image/png") {
    return inspectPng(content);
  }
  if (mediaType === "image/jpeg") return inspectJpeg(content);
  if (mediaType === "image/gif") return inspectGif(content);
  return inspectWebp(content);
}

export function inspectDeksImage(content: Uint8Array, mediaType: string): DeksImageInspection {
  if (mediaType === DEKS_IMAGE_LIMITS.svgMediaType) return normalizeDeksSvg(content);
  if (!(DEKS_IMAGE_LIMITS.rasterMediaTypes as readonly string[]).includes(mediaType)) {
    throw new Error(`unsupported DEKS image media type ${mediaType}`);
  }
  if (content.byteLength > DEKS_IMAGE_LIMITS.maxRasterBytes) throw new Error("DEKS raster image is too large");
  const { width, height, frames } = rasterGeometry(content, mediaType as Exclude<DeksImageMediaType, "image/svg+xml">);
  validateDimensions(width, height, "DEKS raster image");
  if (frames.length > DEKS_IMAGE_LIMITS.maxFrames) throw new Error(`DEKS raster image has more than ${DEKS_IMAGE_LIMITS.maxFrames} frames`);
  let aggregatePixels = 0;
  for (const [frameWidth, frameHeight] of frames) {
    validateDimensions(frameWidth, frameHeight, "DEKS raster frame");
    aggregatePixels += frameWidth * frameHeight;
    if (aggregatePixels > DEKS_IMAGE_LIMITS.maxAggregatePixels) {
      throw new Error(`DEKS raster image exceeds ${DEKS_IMAGE_LIMITS.maxAggregatePixels} aggregate pixels`);
    }
  }
  return { bytes: new Uint8Array(content), mediaType: mediaType as DeksImageMediaType, width, height };
}

export function sniffDeksImageMediaType(content: Uint8Array): DeksImageMediaType | undefined {
  if (!(content instanceof Uint8Array) || content.byteLength === 0) return undefined;
  if (content.byteLength >= 8
    && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => content[index] === byte)) {
    return "image/png";
  }
  if (content.byteLength >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return "image/jpeg";
  }
  if (content.byteLength >= 6) {
    const signature = ascii(content, 0, 6);
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  if (content.byteLength >= 12 && ascii(content, 0, 4) === "RIFF" && ascii(content, 8, 4) === "WEBP") {
    return "image/webp";
  }
  const svgScanBytes = content.byteLength <= DEKS_IMAGE_LIMITS.maxSvgBytes
    ? content.byteLength
    : Math.min(content.byteLength, 4096);
  for (let index = 0; index + 3 < svgScanBytes; index += 1) {
    if (content[index] === 0x3c && content[index + 1] === 0x73
      && content[index + 2] === 0x76 && content[index + 3] === 0x67) {
      return "image/svg+xml";
    }
  }
  return undefined;
}

function imageErrorCode(error: unknown, mediaType: string): DeksImageErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/too large/i.test(message)) return "asset_too_large";
  if (/dimension|logical pixels|more than \d+ (?:nodes|attributes|path characters)|exceeds depth/i.test(message)) {
    return "asset_too_complex";
  }
  if (mediaType === DEKS_IMAGE_LIMITS.svgMediaType) return "asset_unsafe";
  return "asset_media_type_unsupported";
}

export function inspectAndNormalizeDeksImage(
  content: Uint8Array,
  claimedMediaType?: string,
): DeksImageInspection {
  if (!(content instanceof Uint8Array)) throw new DeksImageError("asset_media_type_unsupported");
  if (content.byteLength === 0) throw new DeksImageError("asset_empty");
  const mediaType = sniffDeksImageMediaType(content) ?? claimedMediaType;
  if (!mediaType || (claimedMediaType !== undefined && mediaType !== claimedMediaType)) {
    throw new DeksImageError("asset_media_type_unsupported");
  }
  try {
    return inspectDeksImage(content, mediaType);
  } catch (error) {
    throw new DeksImageError(imageErrorCode(error, mediaType), error);
  }
}

export function normalizeDeksFileAssets<
  T extends { id: string; mediaType: string; bytes: Uint8Array },
>(
  document: DeksImageAssetDescriptorSource,
  assets: readonly T[],
  options: NormalizeDeksFileAssetsOptions = {},
): T[] {
  const allowMissing = options.allowMissing === true;
  const descriptors = new Map(document.assets
    .filter(({ kind }) => kind === "embedded")
    .map((descriptor) => [descriptor.id, descriptor]));
  const byId = new Map<string, T>();
  for (const asset of assets) {
    if (byId.has(asset.id)) throw new DeksImageError("asset_media_type_unsupported");
    const descriptor = descriptors.get(asset.id);
    if (!descriptor || descriptor.mediaType !== asset.mediaType) {
      throw new DeksImageError("asset_media_type_unsupported");
    }
    const inspected = descriptor.mediaType.startsWith("audio/")
      ? inspectAndNormalizeDeksAudio(new Uint8Array(asset.bytes), descriptor.mediaType)
      : inspectAndNormalizeDeksImage(new Uint8Array(asset.bytes), descriptor.mediaType);
    byId.set(asset.id, {
      ...asset,
      mediaType: inspected.mediaType,
      bytes: inspected.bytes,
    });
  }
  if (!allowMissing) {
    for (const id of descriptors.keys()) {
      if (!byId.has(id)) throw new DeksImageError("asset_media_type_unsupported");
    }
  }
  return [...byId.values()];
}
