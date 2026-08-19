/** Named CSS curve or an explicit cubic-bezier control tuple. */
export type EasingName = "linear" | "ease-in" | "ease-out" | "ease-in-out";
export type Easing = EasingName | readonly [number, number, number, number];

export type ElementKind = "text" | "shape" | "image" | "group" | "link-button" | "icon" | "number";
export type ShapeKind = "rectangle" | "ellipse" | "line";

/**
 * The three roles an element can play at a slide boundary. An element that is
 * only on the first slide plays `out`; one that is only on the second plays
 * `in`; one that is on both plays `morph`.
 */
export type MotionRole = "in" | "out" | "morph";
export type MotionEdge = "left" | "right" | "top" | "bottom";

/**
 * How an element appears or disappears.
 *
 * `slide` travels from (or towards) an edge; without `distance` it starts fully
 * outside the canvas, and with one it travels exactly that many canvas units.
 *
 * `crop` travels the same way but inside the element's own rectangle, which
 * masks it. The rectangle never moves and opacity is never touched, so the
 * element reads as revealed from behind an invisible boundary. It takes no
 * distance: the travel is exactly the element's own extent on that axis.
 */
export type PresenceAnimation =
  | { kind: "none" }
  | { kind: "fade" }
  | { kind: "slide"; edge: MotionEdge; distance?: number }
  | { kind: "crop"; edge: MotionEdge }
  | { kind: "scale"; from: number };

/** How an element that persists behaves: it interpolates, or it snaps. */
export type MorphAnimation = { kind: "morph" } | { kind: "cut" };

export interface PresenceMotion {
  animation: PresenceAnimation;
  /** Duration as a multiple of `motionBeatMs`. */
  durationBeats: number;
  delayMs: number;
  easing: Easing;
}

export interface MorphMotion {
  animation: MorphAnimation;
  durationBeats: number;
  delayMs: number;
  easing: Easing;
}

/** A complete motion declaration. Only the document root carries one. */
export interface MotionSpec {
  in: PresenceMotion;
  out: PresenceMotion;
  morph: MorphMotion;
}

/**
 * A partial declaration. Slides and element states carry these: every property
 * they omit keeps resolving from the level above, one property at a time.
 */
export interface MotionPatch {
  in?: Partial<PresenceMotion>;
  out?: Partial<PresenceMotion>;
  morph?: Partial<MorphMotion>;
}

/** Where the symbol sits relative to the digits. */
export type SymbolPosition = "before" | "after";
export type GroupSeparator = "" | "," | "." | " " | "'";
export type DecimalSeparator = "." | ",";

/**
 * Which roles count towards the value. It lives on the element rather than on
 * its states: whether a figure is the kind of figure that counts is a decision
 * about that figure, made once, and per-state toggles would let one checkpoint
 * silently disagree with the next.
 */
export interface AnimateMagnitude {
  in: boolean;
  morph: boolean;
  out: boolean;
}

/**
 * Everything needed to render a magnitude as digits, declared rather than
 * resolved from a locale: `Intl` output follows the ICU build underneath the
 * host, so the same portable file would show `1,234.5` on one machine and
 * `1.234,5` on another.
 */
export interface NumberFormat {
  decimals: number;
  groupSeparator: GroupSeparator;
  decimalSeparator: DecimalSeparator;
  symbol: string;
  symbolPosition: SymbolPosition;
}

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
