import { getLucideIconData, type LucideIconNode } from "@deks-js/document";

export function lucideNodes(name: string): readonly LucideIconNode[] {
  return getLucideIconData(name).nodes;
}

/** @deprecated Use `lucideNodes`; this compatibility view returns path nodes only. */
export function lucidePaths(name: string): readonly string[] {
  return lucideNodes(name).flatMap(([tag, attributes]) => (
    tag === "path" && attributes.d !== undefined ? [attributes.d] : []
  ));
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function serializeNode([tag, attributes]: LucideIconNode): string {
  const serialized = Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
  return `<${tag}${serialized}/>`;
}

/** Serializes a bundled icon for transport adapters such as editable PPTX export. */
export function iconSvgMarkup(name: string, color: string, strokeWidth: number): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) throw new Error("Icon color must be a six-digit hex value");
  if (!Number.isFinite(strokeWidth) || strokeWidth < 0.5 || strokeWidth > 8) {
    throw new Error("Icon stroke width must be between 0.5 and 8");
  }
  const icon = getLucideIconData(name);
  const nodes = icon.nodes.map(serializeNode).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width} ${icon.height}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${nodes}</svg>`;
}

export function createIconSvg(name: string, strokeWidth: number): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = getLucideIconData(name);
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", `0 0 ${icon.width} ${icon.height}`);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(strokeWidth));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attributes] of icon.nodes) {
    const node = document.createElementNS(namespace, tag);
    for (const [attribute, value] of Object.entries(attributes)) node.setAttribute(attribute, value);
    svg.append(node);
  }
  return svg;
}
