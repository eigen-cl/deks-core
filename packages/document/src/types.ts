export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "cubic-bezier";
export type ElementKind = "text" | "shape" | "image" | "link-button";
export type ShapeKind = "rectangle" | "ellipse" | "line";
export type SlidePreset = "none" | "fade" | "glide-top" | "glide-right" | "glide-bottom" | "glide-left";
export type MotionRatio = 0.5 | 0.75 | 1 | 1.5 | 2;

export interface Palette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  subtext: string;
}

export type SlideBackground =
  | { kind: "solid"; color: string }
  | { kind: "linear-gradient"; startColor: string; endColor: string; angleDeg: number };
export type ShapeFill = SlideBackground;

export interface ElementState {
  id: string;
  kind: ElementKind;
  shapeKind?: ShapeKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  opacity: number;
  zIndex: number;
  content?: string;
  fontFamily?: "Poppins" | "Roboto";
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  horizontalAlignment?: "left" | "center" | "right" | "justify";
  verticalAlignment?: "top" | "middle" | "bottom";
  overflowMode?: "visible" | "hidden" | "clip";
  fill?: string;
  shapeFill?: ShapeFill;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  assetId?: string;
  assetUrl?: string;
  alt?: string;
  fit?: "contain" | "cover" | "fill";
  label?: string;
  url?: string;
  textColor?: string;
  renderedTextBounds?: { x: number; y: number; width: number; height: number };
  measurementSource?: "estimated" | "dom";
}

export interface Slide {
  id: string;
  name: string;
  isTemplate: boolean;
  background: SlideBackground;
  inPreset: SlidePreset;
  outPreset: SlidePreset;
  inDurationMultiplier: MotionRatio;
  outDurationMultiplier: MotionRatio;
  elements: ElementState[];
}

export interface ElementTransitionOverride {
  elementId: string;
  animate: boolean;
  durationMultiplier?: MotionRatio;
  delayMs?: number;
}

export interface ElementTransitionMotion {
  elementId: string;
  direction: "in" | "out";
  preset: SlidePreset;
  durationMultiplier: MotionRatio;
  delayMs: number;
}

export interface SlideTransition {
  fromSlideId: string;
  toSlideId: string;
  motionBeatMs: number;
  durationMultiplier: MotionRatio;
  effectiveDurationMs: number;
  delayMs: number;
  easing: Easing;
  bezier?: [number, number, number, number];
  overrides?: ElementTransitionOverride[];
  elementMotions?: ElementTransitionMotion[];
}

export interface DeksDocument {
  id: string;
  name: string;
  revision: number;
  canvasWidth: number;
  canvasHeight: number;
  motionBeatMs: number;
  palette: Palette;
  history: { canUndo: boolean; canRedo: boolean };
  slides: Slide[];
  transitions: SlideTransition[];
}

/** Compatibility name for the document currently consumed by deks-web. */
export type Deck = DeksDocument;

export type HttpsUrl = string & { readonly __httpsUrl: unique symbol };

export interface AssetReference {
  assetId?: string;
  assetUrl?: string;
  alt?: string;
}

/** The host owns filesystem, blob, bundled and remote asset policy. Core never fetches assets. */
export type AssetResolver = (reference: AssetReference) => string | undefined;

export interface DocumentStorage<Document = DeksDocument> {
  read(): Document | undefined;
  write(document: Document): void;
}
