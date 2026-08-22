import type { AnimateMagnitude, AssetResolver, CornerRadii, DecimalSeparator, Easing, GroupSeparator, MotionSpec, SlideBackground, SymbolPosition } from "@deks-js/document";

export interface Rect { x: number; y: number; width: number; height: number }

interface ElementBase {
  id: string;
  name: string;
  rect: Rect;
  rotationDeg: number;
  opacity: number;
  zIndex: number;
  /** Motion resolved for this element on this slide: document, slide, element. */
  motion: MotionSpec;
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

export interface NumberElementSnapshot extends ElementBase {
  kind: "number";
  value: number;
  decimals: number;
  groupSeparator: GroupSeparator;
  decimalSeparator: DecimalSeparator;
  symbol: string;
  symbolPosition: SymbolPosition;
  /** Which roles count towards `value`, carried from the element identity. */
  animateMagnitude: AnimateMagnitude;
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
  /** Ephemeral renderer-only uniform radius; canonical document states use cornerRadii. */
  cornerRadius?: number;
  cornerRadii?: CornerRadii;
}

export interface ImageElementSnapshot extends ElementBase {
  kind: "image";
  src?: string;
  assetId: string;
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

export type ElementSnapshot = TextElementSnapshot | NumberElementSnapshot | ShapeElementSnapshot | ImageElementSnapshot | LinkButtonElementSnapshot | IconElementSnapshot;
export interface SlideSnapshot {
  id: string;
  canvas: { width: number; height: number };
  background: SlideBackground;
  /** The tempo every duration on this slide multiplies. */
  motionBeatMs: number;
  /** Motion resolved for the slide itself: document then slide. */
  motion: MotionSpec;
  elements: ElementSnapshot[];
}

export type ResolvedEasing = Exclude<Easing, readonly [number, number, number, number]> | `cubic-bezier(${string})`;
export type TransitionBehavior = "cut" | "fade" | "morph";
export type TransitionOperationType = "enter" | "change" | "exit";

export interface ResolvedTransitionTiming {
  durationMs: number;
  delayMs: number;
  easing: ResolvedEasing;
}

export interface TransitionOperation {
  elementId: string;
  type: TransitionOperationType;
  from?: ElementSnapshot;
  to?: ElementSnapshot;
  keyframes: [Keyframe, Keyframe];
  effectiveBehavior: TransitionBehavior;
  renderMode: "single" | "crossfade" | "cut";
  timing: ResolvedTransitionTiming;
  crossfadeKeyframes?: {
    from: [Keyframe, Keyframe];
    to: [Keyframe, Keyframe];
  };
  crossfadeTiming?: {
    from: ResolvedTransitionTiming;
    to: ResolvedTransitionTiming;
  };
  /**
   * A crop reveal. The renderer masks the element rectangle and travels the
   * content inside it, so these keyframes belong to a node the compiler cannot
   * see; they are kept apart from `keyframes`, which stay on the element.
   */
  crop?: {
    edge: "left" | "right" | "top" | "bottom";
    keyframes: [Keyframe, Keyframe];
  };
  /**
   * A wipe reveal. Nothing moves: the mask edge travels across the element in
   * place, so these keyframes clip the element rather than displacing it.
   */
  wipe?: {
    edge: "left" | "right" | "top" | "bottom";
    keyframes: [Keyframe, Keyframe];
  };
  /**
   * A magnitude to count through, already resolved from the roles the number's
   * identity enables. Absent when nothing counts.
   */
  magnitude?: { from: number; to: number };
}

export interface LayoutMeasurement {
  elementId: string;
  /** Canonical rectangle declared by the document. */
  rect: Rect;
  /** Axis-aligned bounds calculated from the canonical rectangle and rotation. */
  visualAabb: Rect;
  /** Browser-measured glyph bounds in canonical canvas coordinates. */
  contentRect?: Rect;
  overflowStatus?: "fits" | "overflow";
  sources: {
    rect: "exact";
    visualAabb: "calculated";
    contentRect?: "dom";
  };
}

export type ViewportMode = "presentation" | "editor";
export interface RendererOptions {
  respectReducedMotion?: boolean;
  assetResolver?: AssetResolver;
  onOpenExternal?: (url: string) => void | Promise<void>;
  onSelectElement?: (elementId: string) => void;
}

/** Receives the renderer-owned logical clock normalized to the inclusive 0..1 range. */
export type PlaybackProgressListener = (progress: number) => void;

export interface OnionSkinOptions {
  opacity: number;
}

export interface CompiledTransition {
  from: SlideSnapshot;
  to: SlideSnapshot;
  durationMs: number;
  delayMs: number;
  easing: ResolvedEasing;
  totalDurationMs: number;
  operations: TransitionOperation[];
}
