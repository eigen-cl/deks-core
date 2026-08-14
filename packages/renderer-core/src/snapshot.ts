import type { AssetResolver, ElementState, Slide } from "@deks-js/document";
import type { ElementSnapshot, SlideSnapshot } from "./types.js";

function elementSnapshot(element: ElementState, assetResolver?: AssetResolver): ElementSnapshot {
  const base = {
    id: element.id,
    name: element.name,
    rect: { x: element.x, y: element.y, width: element.width, height: element.height },
    rotationDeg: element.rotationDeg,
    opacity: element.opacity,
    zIndex: element.zIndex,
  };
  if (element.kind === "text") return {
    ...base,
    kind: "text",
    content: element.content ?? "",
    fontFamily: element.fontFamily ?? "Poppins",
    fontSize: element.fontSize ?? 32,
    fontWeight: element.fontWeight ?? 400,
    lineHeight: element.lineHeight ?? 1.2,
    letterSpacing: element.letterSpacing ?? 0,
    horizontalAlignment: element.horizontalAlignment ?? "left",
    verticalAlignment: element.verticalAlignment ?? "top",
    color: element.fill ?? "#000000",
    overflowMode: element.overflowMode ?? "visible",
  };
  if (element.kind === "image") {
    const reference = {
      ...(element.assetId === undefined ? {} : { assetId: element.assetId }),
      ...(element.assetUrl === undefined ? {} : { assetUrl: element.assetUrl }),
      ...(element.alt === undefined ? {} : { alt: element.alt }),
    };
    const src = assetResolver?.(reference) ?? element.assetUrl;
    return {
      ...base,
      kind: "image",
      ...(src === undefined ? {} : { src }),
      ...(element.assetId === undefined ? {} : { assetId: element.assetId }),
      ...(element.assetUrl === undefined ? {} : { assetUrl: element.assetUrl }),
      alt: element.alt ?? "",
      fit: element.fit ?? "contain",
    };
  }
  if (element.kind === "link-button") return {
    ...base,
    kind: "link-button",
    label: element.label ?? "",
    url: element.url ?? "",
    fill: element.fill ?? "#000000",
    textColor: element.textColor ?? "#ffffff",
    fontFamily: element.fontFamily ?? "Poppins",
    fontSize: element.fontSize ?? 32,
    fontWeight: element.fontWeight ?? 600,
    cornerRadius: element.cornerRadius ?? 0,
    ...(element.stroke === undefined ? {} : { stroke: element.stroke }),
    ...(element.strokeWidth === undefined ? {} : { strokeWidth: element.strokeWidth }),
  };
  if (element.kind === "icon") return {
    ...base,
    kind: "icon",
    family: element.iconFamily ?? "lucide",
    iconName: element.iconName ?? "shield-check",
    color: element.fill ?? "#000000",
    strokeWidth: element.strokeWidth ?? 2,
  };
  return {
    ...base,
    kind: "shape",
    shapeKind: element.shapeKind ?? "rectangle",
    ...(element.shapeFill ? { fillStyle: element.shapeFill } : element.fill ? { fillStyle: { kind: "solid" as const, color: element.fill } } : {}),
    ...(element.stroke === undefined ? {} : { stroke: element.stroke }),
    ...(element.strokeWidth === undefined ? {} : { strokeWidth: element.strokeWidth }),
    ...(element.cornerRadius === undefined ? {} : { cornerRadius: element.cornerRadius }),
  };
}

export function toSlideSnapshot(
  slide: Slide,
  canvas: { width: number; height: number },
  assetResolver?: AssetResolver,
): SlideSnapshot {
  return {
    id: slide.id,
    canvas,
    background: slide.background,
    elements: slide.elements.map((element) => elementSnapshot(element, assetResolver)),
  };
}
