import type {
  AssetResolver,
  CornerRadii,
  Easing,
  MotionRatio,
  SlideBackground,
  SlidePreset,
} from "@deks-js/document";

// El vocabulario del renderer es el del documento. Redefinir `SlideBackground`
// o `CornerRadii` aquí crearía dos verdades para la misma forma: los tipos
// compartidos se importan y se reexportan, nunca se copian.
export type { AssetResolver, CornerRadii, Easing, MotionRatio, SlideBackground, SlidePreset };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ElementBase {
  id: string;
  /** Etiqueta accesible del elemento. Ausente en snapshots escritos a mano. */
  name?: string;
  rect: Rect;
  rotationDeg: number;
  opacity: number;
  zIndex: number;
  semanticRole?: string;
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
  overflowMode?: "visible" | "hidden" | "clip";
}

export interface ShapeElementSnapshot extends ElementBase {
  kind: "shape";
  shapeKind: "rectangle" | "ellipse" | "line";
  fillStyle?: SlideBackground;
  stroke?: string;
  strokeWidth?: number;
  /** Radio uniforme efímero del renderer; el documento canónico usa `cornerRadii`. */
  cornerRadius?: number;
  cornerRadii?: CornerRadii;
}

export interface ImageElementSnapshot extends ElementBase {
  kind: "image";
  /** Ausente cuando el host no resuelve el asset. El renderer dibuja un placeholder. */
  src?: string;
  assetId?: string;
  alt: string;
  fit: "contain" | "cover" | "fill";
}

export interface LinkButtonElementSnapshot extends ElementBase {
  kind: "link-button";
  label: string;
  /** Sólo una URL HTTPS absoluta es válida en el borde del renderer. */
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

export type ElementSnapshot =
  | TextElementSnapshot
  | ShapeElementSnapshot
  | ImageElementSnapshot
  | LinkButtonElementSnapshot
  | IconElementSnapshot;

export interface SlideSnapshot {
  id: string;
  canvas: { width: number; height: number };
  background?: SlideBackground;
  elements: ElementSnapshot[];
  inPreset?: SlidePreset;
  outPreset?: SlidePreset;
  inDurationMultiplier?: number;
  outDurationMultiplier?: number;
}

/** `Easing` declara la intención; su forma resuelta ya lleva la curva concreta. */
export type ResolvedEasing = Exclude<Easing, "cubic-bezier"> | `cubic-bezier(${string})`;

/** Coreografía de presencia de un elemento, con el vocabulario del documento. */
export interface PresenceTransitionPreset {
  preset: SlidePreset;
  /** Multiplicador directo del beat global para esta operación de presencia. */
  durationMultiplier: MotionRatio;
}

export interface ElementPresenceMotion extends PresenceTransitionPreset {
  delayMs: number;
}

export interface ElementPresenceMotions {
  in?: ElementPresenceMotion;
  out?: ElementPresenceMotion;
}

export interface ElementTransitionOverride {
  /** `false` siempre resuelve a un corte de duración cero. */
  animate: boolean;
  /** Multiplicador directo del beat global; omitirlo hereda el del tramo. */
  durationMultiplier?: MotionRatio;
  delayMs?: number;
}

export interface TransitionOptions {
  /** Reloj de motion de la presentación, en milisegundos. */
  motionBeatMs: number;
  /** Duración del tramo como multiplicador directo del beat global. */
  durationMultiplier: MotionRatio;
  delayMs: number;
  easing: ResolvedEasing;
  inPreset?: PresenceTransitionPreset;
  outPreset?: PresenceTransitionPreset;
  overrides?: Record<string, ElementTransitionOverride>;
  /** Coreografía de presencia propia de un elemento en este tramo. */
  elementMotions?: Record<string, ElementPresenceMotions>;
}

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
  /** Exactamente dos checkpoints. Los keyframes intermedios no son parte del modelo. */
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
}

export interface CompiledTransition {
  fromSlideId: string;
  toSlideId: string;
  motionBeatMs: number;
  durationMultiplier: MotionRatio;
  /** Duración resuelta del tramo para quien consume WAAPI. */
  durationMs: number;
  delayMs: number;
  easing: ResolvedEasing;
  inPreset?: PresenceTransitionPreset;
  outPreset?: PresenceTransitionPreset;
  totalDurationMs: number;
  operations: TransitionOperation[];
}

export interface LayoutMeasurement {
  elementId: string;
  /** Rectángulo canónico declarado por el documento. */
  rect: Rect;
  /** Caja alineada a ejes calculada desde el rectángulo canónico y la rotación. */
  visualAabb: Rect;
  /** Bounds de glifos medidos por el navegador, en coordenadas del lienzo. */
  contentRect?: Rect;
  overflowStatus?: "fits" | "overflow";
  sources: {
    rect: "exact";
    visualAabb: "calculated";
    contentRect?: "dom";
  };
}

export interface RendererOptions {
  respectReducedMotion?: boolean;
  /** El host es dueño de la política de assets; Core nunca los descarga. */
  assetResolver?: AssetResolver;
  /** Delega la navegación externa al host que embebe (navegador, Tauri, etc.). */
  onOpenExternal?: (url: string) => void | Promise<void>;
  onSelectElement?: (elementId: string) => void;
}

/** Recibe el reloj lógico normalizado sin acoplarlo a un framework de UI. */
export type PlaybackProgressListener = (progress: number) => void;

export type ViewportMode = "presentation" | "editor";

export interface OnionSkinOptions {
  opacity: number;
}
