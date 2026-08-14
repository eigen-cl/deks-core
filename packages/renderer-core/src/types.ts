import type { AssetResolver, SlideBackground, SlideTransition } from "@deks-js/document";

export interface Rect { x: number; y: number; width: number; height: number }

interface ElementBase {
  id: string;
  name: string;
  rect: Rect;
  rotationDeg: number;
  opacity: number;
  zIndex: number;
}

export interface TextElementSnapshot extends ElementBase {
  kind: "text";
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  horizontalAlignment: "left" | "center" | "right" | "justify";
  verticalAlignment: "top" | "middle" | "bottom";
  color: string;
  overflowMode: "visible" | "hidden" | "clip";
}

export interface ShapeElementSnapshot extends ElementBase {
  kind: "shape";
  shapeKind: "rectangle" | "ellipse" | "line";
  fillStyle?: SlideBackground;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
}

export interface ImageElementSnapshot extends ElementBase {
  kind: "image";
  src?: string;
  assetId?: string;
  assetUrl?: string;
  alt: string;
  fit: "contain" | "cover" | "fill";
}

export interface LinkButtonElementSnapshot extends ElementBase {
  kind: "link-button";
  label: string;
  url: string;
  fill: string;
  textColor: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  cornerRadius: number;
  stroke?: string;
  strokeWidth?: number;
}

export interface IconElementSnapshot extends ElementBase {
  kind: "icon";
  family: "lucide";
  iconName: string;
  color: string;
  strokeWidth: number;
}

export type ElementSnapshot = TextElementSnapshot | ShapeElementSnapshot | ImageElementSnapshot | LinkButtonElementSnapshot | IconElementSnapshot;
export interface SlideSnapshot {
  id: string;
  canvas: { width: number; height: number };
  background: SlideBackground;
  elements: ElementSnapshot[];
}

export type ViewportMode = "presentation" | "editor";
export interface RendererOptions {
  respectReducedMotion?: boolean;
  assetResolver?: AssetResolver;
  onOpenExternal?: (url: string) => void | Promise<void>;
  onSelectElement?: (elementId: string) => void;
}

export interface CompiledTransition {
  from: SlideSnapshot;
  to: SlideSnapshot;
  options: SlideTransition;
  durationMs: number;
}
