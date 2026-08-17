import type {
  AssetResolver,
  DeksDocument,
  DeksElement,
  DeksElementState,
  SlideTransition,
} from "@deks-js/document";
import type {
  ElementPresenceMotions,
  ElementSnapshot,
  ElementTransitionOverride,
  ResolvedEasing,
  SlideSnapshot,
  TransitionOptions,
} from "./types.js";

function elementSnapshot(
  identity: DeksElement,
  state: DeksElementState,
  assetResolver?: AssetResolver,
): ElementSnapshot | undefined {
  const base = {
    id: identity.id,
    name: identity.name,
    rect: { x: state.x, y: state.y, width: state.width, height: state.height },
    rotationDeg: state.rotationDeg,
    opacity: state.opacity,
    zIndex: state.zIndex,
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

/**
 * `Easing` declara la intención y `bezier` la curva; el renderer sólo entiende
 * la forma ya resuelta.
 */
export function toResolvedEasing(
  easing: SlideTransition["easing"],
  bezier: SlideTransition["bezier"],
): ResolvedEasing {
  if (easing !== "cubic-bezier") return easing;
  if (!bezier) throw new Error("cubic-bezier requires its four control values");
  return `cubic-bezier(${bezier.join(", ")})`;
}

/**
 * Proyecta la arista canónica a las opciones del renderer. El documento guarda
 * overrides y motions como listas con `elementId` dentro; el renderer los busca
 * por elemento, así que aquí se indexan. La presencia sale de las slides: entrar
 * es el `inPreset` del destino y salir el `outPreset` del origen.
 */
export function toTransitionOptions(
  document: DeksDocument,
  fromSlideId: string,
  toSlideId: string,
): TransitionOptions {
  // La arista se resuelve por identidad de slide, en cualquier sentido:
  // retroceder reproduce la misma transición en reversa en vez de no encontrar
  // nada. La presencia no se invierte con ella porque sale de las slides.
  const edge = document.transitions.find(
    (transition) => transition.fromSlideId === fromSlideId && transition.toSlideId === toSlideId,
  ) ?? document.transitions.find(
    (transition) => transition.fromSlideId === toSlideId && transition.toSlideId === fromSlideId,
  );
  if (!edge) throw new Error(`transition ${fromSlideId} -> ${toSlideId} is missing`);
  const from = document.slides.find(({ id }) => id === fromSlideId);
  const to = document.slides.find(({ id }) => id === toSlideId);
  if (!from || !to) throw new Error(`transition ${fromSlideId} -> ${toSlideId} points at a missing slide`);

  const overrides: Record<string, ElementTransitionOverride> = {};
  for (const override of edge.overrides ?? []) {
    overrides[override.elementId] = {
      animate: override.animate,
      ...(override.durationMultiplier === undefined ? {} : { durationMultiplier: override.durationMultiplier }),
      ...(override.delayMs === undefined ? {} : { delayMs: override.delayMs }),
    };
  }

  const elementMotions: Record<string, ElementPresenceMotions> = {};
  for (const motion of edge.elementMotions ?? []) {
    const existing = elementMotions[motion.elementId] ?? {};
    existing[motion.direction] = {
      preset: motion.preset,
      durationMultiplier: motion.durationMultiplier,
      delayMs: motion.delayMs,
    };
    elementMotions[motion.elementId] = existing;
  }

  return {
    motionBeatMs: edge.motionBeatMs,
    durationMultiplier: edge.durationMultiplier,
    delayMs: edge.delayMs,
    easing: toResolvedEasing(edge.easing, edge.bezier),
    inPreset: { preset: to.inPreset, durationMultiplier: to.inDurationMultiplier },
    outPreset: { preset: from.outPreset, durationMultiplier: from.outDurationMultiplier },
    ...(Object.keys(overrides).length === 0 ? {} : { overrides }),
    ...(Object.keys(elementMotions).length === 0 ? {} : { elementMotions }),
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
  return {
    id: slide.id,
    canvas: document.canvas,
    background: slide.background,
    inPreset: slide.inPreset,
    outPreset: slide.outPreset,
    inDurationMultiplier: slide.inDurationMultiplier,
    outDurationMultiplier: slide.outDurationMultiplier,
    elements: slide.states.flatMap((state) => {
      const identity = identities.get(state.elementId);
      if (!identity) throw new Error(`element ${state.elementId} is missing`);
      const snapshot = elementSnapshot(identity, state, assetResolver);
      return snapshot === undefined ? [] : [snapshot];
    }),
  };
}
