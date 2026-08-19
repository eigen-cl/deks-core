import type {
  AssetResolver,
  DeksDocument,
  DeksElement,
  DeksElementState,
  MotionSpec,
} from "@deks-js/document";
import { mergeMotion } from "@deks-js/document";
import type { ElementSnapshot, SlideSnapshot } from "./types.js";

function elementSnapshot(
  identity: DeksElement,
  state: DeksElementState,
  motion: MotionSpec,
  assetResolver?: AssetResolver,
): ElementSnapshot | undefined {
  const base = {
    id: identity.id,
    name: identity.name,
    rect: { x: state.x, y: state.y, width: state.width, height: state.height },
    rotationDeg: state.rotationDeg,
    opacity: state.opacity,
    zIndex: state.zIndex,
    motion,
  };
  if (identity.kind === "text") return {
    ...base,
    kind: "text",
    content: state.content!,
    fontFamily: state.fontFamily!,
    fontSize: state.fontSize!,
    fontWeight: state.fontWeight!,
    lineHeight: state.lineHeight!,
    letterSpacing: state.letterSpacing!,
    horizontalAlignment: state.horizontalAlignment!,
    verticalAlignment: state.verticalAlignment!,
    color: state.fill!,
    overflowMode: state.overflowMode!,
  };
  if (identity.kind === "number") return {
    ...base,
    kind: "number",
    value: state.value!,
    decimals: state.decimals!,
    groupSeparator: state.groupSeparator!,
    decimalSeparator: state.decimalSeparator!,
    symbol: state.symbol!,
    symbolPosition: state.symbolPosition!,
    // Carried from identity, not from the state: the document decided once
    // whether this figure counts, and the compiler must not have to look the
    // element up again to find out.
    animateMagnitude: identity.animateMagnitude!,
    fontFamily: state.fontFamily!,
    fontSize: state.fontSize!,
    fontWeight: state.fontWeight!,
    lineHeight: state.lineHeight!,
    letterSpacing: state.letterSpacing!,
    horizontalAlignment: state.horizontalAlignment!,
    verticalAlignment: state.verticalAlignment!,
    color: state.fill!,
    overflowMode: state.overflowMode!,
  };
  if (identity.kind === "image") {
    const reference = { assetId: state.assetId!, alt: state.alt! };
    const src = assetResolver?.(reference);
    return {
      ...base,
      kind: "image",
      ...(src === undefined ? {} : { src }),
      assetId: state.assetId!,
      alt: state.alt!,
      fit: state.fit!,
    };
  }
  if (identity.kind === "link-button") return {
    ...base,
    kind: "link-button",
    label: state.label!,
    url: state.url!,
    fill: state.fill!,
    textColor: state.textColor!,
    fontFamily: state.fontFamily!,
    fontSize: state.fontSize!,
    fontWeight: state.fontWeight!,
    cornerRadius: state.cornerRadius!,
    stroke: state.stroke!,
    strokeWidth: state.strokeWidth!,
  };
  if (identity.kind === "icon") return {
    ...base,
    kind: "icon",
    family: state.iconFamily!,
    iconName: state.iconName!,
    color: state.fill!,
    strokeWidth: state.strokeWidth!,
  };
  if (identity.kind === "group") return undefined;
  return {
    ...base,
    kind: "shape",
    shapeKind: identity.shapeKind!,
    fillStyle: state.shapeFill!,
    stroke: state.stroke!,
    strokeWidth: state.strokeWidth!,
    ...(state.cornerRadii === undefined ? {} : { cornerRadii: state.cornerRadii }),
  };
}

export function toSlideSnapshot(
  document: DeksDocument,
  slideId: string,
  assetResolver?: AssetResolver,
): SlideSnapshot {
  const slide = document.slides.find(({ id }) => id === slideId);
  if (!slide) throw new Error(`slide ${slideId} is missing`);
  const identities = new Map(document.elements.map((element) => [element.id, element]));
  // Motion is resolved once, here: the compiler downstream never has to know
  // that a value came from the document, the slide or the element.
  const slideMotion = mergeMotion(document.motion, slide.motion);
  return {
    id: slide.id,
    canvas: document.canvas,
    background: slide.background,
    motionBeatMs: document.motionBeatMs,
    motion: slideMotion,
    elements: slide.states.flatMap((state) => {
      const identity = identities.get(state.elementId);
      if (!identity) throw new Error(`element ${state.elementId} is missing`);
      const snapshot = elementSnapshot(identity, state, mergeMotion(slideMotion, state.motion), assetResolver);
      return snapshot === undefined ? [] : [snapshot];
    }),
  };
}
