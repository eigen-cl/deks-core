export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "cubic-bezier";
export type ElementKind = "text" | "shape" | "image" | "group" | "link-button" | "icon";
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

export interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
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

export type HttpsUrl = string & { readonly __httpsUrl: unique symbol };

export interface AssetReference {
  assetId: string;
  alt?: string;
}

/** The host owns filesystem, blob, bundled and remote asset policy. Core never fetches assets. */
export type AssetResolver = (reference: AssetReference) => string | undefined;

export interface DocumentStorage<Document> {
  read(): Document | undefined;
  write(document: Document): void;
}
