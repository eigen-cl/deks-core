import type {
  CompiledTransition,
  Easing,
  ElementPresenceMotion,
  ElementPresenceMotions,
  ElementTransitionOverride,
  ElementSnapshot,
  SlideSnapshot,
  TransitionOperation,
  TransitionOptions,
  ResolvedTransitionTiming,
  SlideBackground,
  TransitionBehavior
} from "./types.js";
import { cornerRadiusCss, cornerRadiusValues } from "./corner-radii.js";

const PRESET_EASINGS = new Set(["linear", "ease-in", "ease-out", "ease-in-out"]);
const MOTION_RATIOS = new Set([0.5, 0.75, 1, 1.5, 2]);
const CUBIC_BEZIER = /^cubic-bezier\(\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*\)$/;
const PRESENCE_PRESETS = new Set([
  "none", "fade", "glide-top", "glide-right", "glide-bottom", "glide-left"
]);

const assertFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};

export const validateEasing = (easing: string): easing is Easing => {
  if (PRESET_EASINGS.has(easing)) return true;
  const match = CUBIC_BEZIER.exec(easing);
  if (!match) return false;
  const values = match.slice(1).map(Number);
  return values.every(Number.isFinite) && values[0]! >= 0 && values[0]! <= 1
    && values[2]! >= 0 && values[2]! <= 1;
};

export const validateSnapshot = (snapshot: SlideSnapshot): void => {
  if ("backgroundColor" in snapshot) {
    throw new Error("backgroundColor is not supported; use background");
  }
  assertFinite(snapshot.canvas.width, "canvas.width");
  assertFinite(snapshot.canvas.height, "canvas.height");
  if (snapshot.canvas.width <= 0 || snapshot.canvas.height <= 0) {
    throw new Error("canvas dimensions must be positive");
  }

  const ids = new Set<string>();
  for (const element of snapshot.elements) {
    if (ids.has(element.id)) throw new Error(`duplicate element id: ${element.id}`);
    ids.add(element.id);
    const { x, y, width, height } = element.rect;
    for (const [label, value] of Object.entries({ x, y, width, height })) {
      assertFinite(value, `${element.id}.rect.${label}`);
    }
    assertFinite(element.rotationDeg, `${element.id}.rotationDeg`);
    assertFinite(element.opacity, `${element.id}.opacity`);
    assertFinite(element.zIndex, `${element.id}.zIndex`);
    if (width <= 0 || height <= 0) throw new Error(`${element.id} width and height must be positive`);
    if (element.opacity < 0 || element.opacity > 1) throw new Error(`${element.id} opacity must be between 0 and 1`);
    if (element.kind === "shape" && element.fillStyle?.kind === "linear-gradient") {
      assertFinite(element.fillStyle.angleDeg, `${element.id}.fillStyle.angleDeg`);
    }
    if (element.kind === "shape") {
      for (const value of cornerRadiusValues(element.cornerRadii)) {
        assertFinite(value, `${element.id}.cornerRadius`);
        if (value < 0 || value > 100_000) throw new Error(`${element.id}.cornerRadius is invalid`);
      }
    }
    if (element.kind === "link-button") {
      let url: URL;
      try {
        url = new URL(element.url);
      } catch {
        throw new Error(`${element.id}.url must be an absolute https URL`);
      }
      if (url.protocol !== "https:" || url.username || url.password || element.url.length > 2048) {
        throw new Error(`${element.id}.url must be an absolute https URL`);
      }
      if (!element.label.trim() || element.label.length > 200) throw new Error(`${element.id}.label is invalid`);
      for (const [label, value] of Object.entries({
        fontSize: element.fontSize,
        fontWeight: element.fontWeight,
        cornerRadius: element.cornerRadius,
        strokeWidth: element.strokeWidth ?? 0,
      })) assertFinite(value, `${element.id}.${label}`);
    }
    if (element.kind === "icon") {
      if (element.family !== "lucide") throw new Error(`${element.id}.family is not registered`);
      if (!/^#[0-9A-Fa-f]{6}$/.test(element.color)) throw new Error(`${element.id}.color is invalid`);
      assertFinite(element.strokeWidth, `${element.id}.strokeWidth`);
      if (element.strokeWidth < 0.5 || element.strokeWidth > 8) throw new Error(`${element.id}.strokeWidth is invalid`);
    }
  }
};

const keyframe = (state: ElementSnapshot): Keyframe => {
  const frame: Keyframe = {
    left: `${state.rect.x}px`,
    top: `${state.rect.y}px`,
    width: `${state.rect.width}px`,
    height: `${state.rect.height}px`,
    transform: `rotate(${state.rotationDeg}deg)`,
    opacity: state.opacity
  };
  if (state.kind === "text") {
    Object.assign(frame, {
      color: state.color,
      fontSize: `${state.fontSize}px`,
      fontWeight: state.fontWeight,
      letterSpacing: `${state.letterSpacing}px`,
      lineHeight: state.lineHeight
    });
  }
  if (state.kind === "shape") {
    // Igual que en el renderer: sin relleno declarado, la forma es transparente.
    const fill: SlideBackground = state.fillStyle ?? { kind: "solid", color: "transparent" };
    Object.assign(frame, {
      backgroundColor: state.shapeKind === "line" || fill.kind === "linear-gradient"
        ? "transparent"
        : fill.color,
      backgroundImage: state.shapeKind !== "line" && fill.kind === "linear-gradient"
        ? `linear-gradient(${fill.angleDeg}deg, ${fill.startColor}, ${fill.endColor})`
        : "none",
      borderColor: state.stroke ?? (state.shapeKind === "line" ? "currentColor" : "transparent"),
      borderWidth: `${state.strokeWidth ?? (state.shapeKind === "line" ? 1 : 0)}px`,
      borderRadius: state.shapeKind === "ellipse" ? "50%" : cornerRadiusCss(state.cornerRadii)
    });
  }
  if (state.kind === "link-button") {
    Object.assign(frame, {
      backgroundColor: state.fill,
      color: state.textColor,
      fontSize: `${state.fontSize}px`,
      fontWeight: state.fontWeight,
      borderColor: state.stroke ?? "transparent",
      borderWidth: `${state.strokeWidth ?? 0}px`,
      borderRadius: `${state.cornerRadius}px`,
    });
  }
  if (state.kind === "icon") Object.assign(frame, { color: state.color });
  return frame;
};

const hasDiscreteChange = (from: ElementSnapshot, to: ElementSnapshot): boolean => {
  if (from.kind !== to.kind) return true;
  if (from.kind === "text" && to.kind === "text") {
    return from.content !== to.content
      || from.fontFamily !== to.fontFamily
      || from.horizontalAlignment !== to.horizontalAlignment
      || from.verticalAlignment !== to.verticalAlignment;
  }
  if (from.kind === "image" && to.kind === "image") {
    return from.src !== to.src || from.fit !== to.fit;
  }
  if (from.kind === "shape" && to.kind === "shape") {
    const fromFillKind = from.fillStyle?.kind ?? "solid";
    const toFillKind = to.fillStyle?.kind ?? "solid";
    return from.shapeKind !== to.shapeKind || fromFillKind !== toFillKind;
  }
  if (from.kind === "link-button" && to.kind === "link-button") {
    return from.label !== to.label || from.url !== to.url || from.fontFamily !== to.fontFamily;
  }
  if (from.kind === "icon" && to.kind === "icon") {
    return from.family !== to.family || from.iconName !== to.iconName || from.strokeWidth !== to.strokeWidth;
  }
  return false;
};

const validateRatio = (value: number, label: string): void => {
  assertFinite(value, label);
  if (!MOTION_RATIOS.has(value)) {
    throw new Error(`${label} must be one of 0.5, 0.75, 1, 1.5, or 2`);
  }
};

const validatePresencePreset = (
  preset: NonNullable<TransitionOptions["inPreset"]> | undefined,
  label: string
): void => {
  if (!preset) return;
  if (!PRESENCE_PRESETS.has(preset.preset)) throw new Error(`invalid presence preset: ${preset.preset}`);
  for (const key of Object.keys(preset)) {
    if (key !== "preset" && key !== "durationMultiplier") {
      throw new Error(`${label}.${key} is not supported`);
    }
  }
  validateRatio(preset.durationMultiplier, `${label}.durationMultiplier`);
};

const resolveTiming = (
  options: TransitionOptions,
  override: ElementTransitionOverride | undefined,
  elementId: string,
  type: TransitionOperation["type"],
  motion?: ElementPresenceMotion,
): ResolvedTransitionTiming => {
  const preset = type === "enter" ? options.inPreset : type === "exit" ? options.outPreset : undefined;
  if (override) {
    for (const key of Object.keys(override)) {
      if (key !== "animate" && key !== "durationMultiplier" && key !== "delayMs") {
        const replacement = key === "durationMs" ? "; use durationMultiplier" : "";
        throw new Error(`${elementId}.${key} is not supported${replacement}`);
      }
    }
    if (typeof override.animate !== "boolean") throw new Error(`${elementId}.animate must be boolean`);
  }
  if (override?.durationMultiplier !== undefined) {
    validateRatio(override.durationMultiplier, `${elementId}.durationMultiplier`);
  }
  const durationMultiplier = motion?.preset === "none"
    ? 0
    : motion?.durationMultiplier
    ?? override?.durationMultiplier
    ?? (preset?.preset === "none" ? 0 : preset?.durationMultiplier)
    ?? options.durationMultiplier;
  const timing = {
    durationMs: override?.animate === false
      ? 0
      : options.motionBeatMs * durationMultiplier,
    delayMs: motion?.delayMs ?? override?.delayMs ?? options.delayMs,
    easing: motion ? (type === "exit" ? "ease-in" : "ease-out") : options.easing,
  };
  assertFinite(timing.durationMs, `${elementId}.durationMs`);
  assertFinite(timing.delayMs, `${elementId}.delayMs`);
  if (timing.durationMs < 0) throw new Error(`${elementId}.durationMs must not be negative`);
  if (timing.delayMs < 0) throw new Error(`${elementId}.delayMs must not be negative`);
  if (!validateEasing(timing.easing)) throw new Error(`invalid easing: ${timing.easing}`);
  return timing;
};

const presenceKind = (
  type: TransitionOperation["type"],
  options: TransitionOptions,
  motion?: ElementPresenceMotion,
) => motion?.preset ?? (type === "enter" ? options.inPreset?.preset : type === "exit" ? options.outPreset?.preset : undefined);

const offCanvasState = (
  state: ElementSnapshot,
  kind: NonNullable<ReturnType<typeof presenceKind>>,
  canvas: SlideSnapshot["canvas"]
): ElementSnapshot => {
  const rect = { ...state.rect };
  if (kind === "glide-top") rect.y = -rect.height;
  if (kind === "glide-right") rect.x = canvas.width;
  if (kind === "glide-bottom") rect.y = canvas.height;
  if (kind === "glide-left") rect.x = -rect.width;
  return { ...state, rect };
};

const resolveBehavior = (
  from: ElementSnapshot | undefined,
  to: ElementSnapshot | undefined
): TransitionBehavior => {
  const discrete = Boolean(from && to && hasDiscreteChange(from, to));
  if (!from || !to) return "fade";
  return discrete ? "fade" : "morph";
};

const operationFor = (
  elementId: string,
  from: ElementSnapshot | undefined,
  to: ElementSnapshot | undefined,
  options: TransitionOptions,
  canvas: SlideSnapshot["canvas"]
): TransitionOperation => {
  const override = options.overrides?.[elementId];
  const motions = options.elementMotions?.[elementId];
  const type: TransitionOperation["type"] = from && to ? "change" : from ? "exit" : "enter";
  const motion = type === "enter" ? motions?.in : type === "exit" ? motions?.out : undefined;
  const preset = presenceKind(type, options, motion);
  const timing = resolveTiming(options, override, elementId, type, motion);
  const effectiveBehavior = override?.animate === false || preset === "none"
    ? "cut"
    : resolveBehavior(from, to);
  const renderMode: TransitionOperation["renderMode"] = effectiveBehavior === "cut"
    ? "cut"
    : effectiveBehavior === "fade" && from && to
      ? "crossfade"
      : "single";
  const common = { effectiveBehavior, renderMode, timing };
  if (from && to) {
    const fromFrame = keyframe(from);
    const toFrame = keyframe(to);
    if (motions?.in || motions?.out) {
      const exitKind = motions.out?.preset ?? "fade";
      const enterKind = motions.in?.preset ?? "fade";
      const exitDestination = exitKind.startsWith("glide-")
        ? offCanvasState(from, exitKind, canvas)
        : from;
      const enterOrigin = enterKind.startsWith("glide-")
        ? offCanvasState(to, enterKind, canvas)
        : to;
      const fromTiming = resolveTiming(options, override, elementId, "exit", motions.out);
      const toTiming = resolveTiming(options, override, elementId, "enter", motions.in);
      const cut = override?.animate === false
        || (exitKind === "none" && enterKind === "none");
      return {
        elementId,
        type: "change",
        from,
        to,
        keyframes: [fromFrame, toFrame],
        effectiveBehavior: cut ? "cut" : "fade",
        renderMode: cut ? "cut" : "crossfade",
        timing,
        crossfadeKeyframes: {
          from: [fromFrame, { ...keyframe(exitDestination), opacity: 0 }],
          to: [{ ...keyframe(enterOrigin), opacity: 0 }, toFrame],
        },
        crossfadeTiming: { from: fromTiming, to: toTiming },
      };
    }
    return {
      elementId,
      type: "change",
      from,
      to,
      keyframes: [fromFrame, toFrame],
      ...common,
      ...(renderMode === "crossfade" || renderMode === "cut" ? {
        crossfadeKeyframes: {
          from: [
            fromFrame,
            { ...fromFrame, opacity: 0 }
          ] as [Keyframe, Keyframe],
          to: [
            { ...toFrame, opacity: 0 },
            toFrame
          ] as [Keyframe, Keyframe]
        }
      } : {})
    };
  }
  if (from) {
    const destination = preset?.startsWith("glide-") ? offCanvasState(from, preset, canvas) : from;
    return {
      elementId,
      type: "exit",
      from,
      keyframes: [keyframe(from), { ...keyframe(destination), opacity: 0 }],
      ...common
    };
  }
  if (!to) throw new Error("transition operation requires an endpoint");
  const origin = preset?.startsWith("glide-") ? offCanvasState(to, preset, canvas) : to;
  return {
    elementId,
    type: "enter",
    to,
    keyframes: [{ ...keyframe(origin), opacity: 0 }, keyframe(to)],
    ...common
  };
};

export const compileTransition = (
  from: SlideSnapshot,
  to: SlideSnapshot,
  options: TransitionOptions
): CompiledTransition => {
  validateSnapshot(from);
  validateSnapshot(to);
  if (from.canvas.width !== to.canvas.width || from.canvas.height !== to.canvas.height) {
    throw new Error("transition endpoints must share canvas dimensions");
  }
  for (const key of Object.keys(options)) {
    if (!["motionBeatMs", "durationMultiplier", "delayMs", "easing", "inPreset", "outPreset", "overrides", "elementMotions"].includes(key)) {
      const replacement = key === "durationMs" ? "; use motionBeatMs and durationMultiplier" : "";
      throw new Error(`${key} is not supported${replacement}`);
    }
  }
  assertFinite(options.motionBeatMs, "motionBeatMs");
  validateRatio(options.durationMultiplier, "durationMultiplier");
  assertFinite(options.delayMs, "delayMs");
  if (options.motionBeatMs <= 0) throw new Error("motionBeatMs must be positive");
  if (options.delayMs < 0) throw new Error("delayMs must not be negative");
  if (!validateEasing(options.easing)) throw new Error(`invalid easing: ${options.easing}`);
  validatePresencePreset(options.inPreset, "inPreset");
  validatePresencePreset(options.outPreset, "outPreset");

  for (const [elementId, motions] of Object.entries(options.elementMotions ?? {})) {
    for (const key of Object.keys(motions)) {
      if (key !== "in" && key !== "out") throw new Error(`${elementId}.${key} is not supported`);
    }
    for (const [direction, motion] of Object.entries(motions) as Array<[keyof ElementPresenceMotions, ElementPresenceMotion]>) {
      if (!PRESENCE_PRESETS.has(motion.preset)) throw new Error(`invalid element motion preset: ${motion.preset}`);
      for (const key of Object.keys(motion)) {
        if (key !== "preset" && key !== "durationMultiplier" && key !== "delayMs") {
          throw new Error(`${elementId}.${direction}.${key} is not supported`);
        }
      }
      validateRatio(motion.durationMultiplier, `${elementId}.${direction}.durationMultiplier`);
      assertFinite(motion.delayMs, `${elementId}.${direction}.delayMs`);
      if (motion.delayMs < 0) throw new Error(`${elementId}.${direction}.delayMs must not be negative`);
    }
  }

  const fromById = new Map(from.elements.map((element) => [element.id, element]));
  const toById = new Map(to.elements.map((element) => [element.id, element]));
  const orderedIds = [...fromById.keys(), ...toById.keys()].filter(
    (id, index, ids) => ids.indexOf(id) === index
  );
  for (const elementId of Object.keys(options.overrides ?? {})) {
    if (!fromById.has(elementId) && !toById.has(elementId)) {
      throw new Error(`transition override references unknown element: ${elementId}`);
    }
  }
  for (const elementId of Object.keys(options.elementMotions ?? {})) {
    if (!fromById.has(elementId) && !toById.has(elementId)) {
      throw new Error(`element motion references unknown element: ${elementId}`);
    }
  }
  const operations = orderedIds.map((id) => operationFor(id, fromById.get(id), toById.get(id), options, from.canvas));
  const durationMs = options.motionBeatMs * options.durationMultiplier;
  assertFinite(durationMs, "resolved durationMs");

  return {
    fromSlideId: from.id,
    toSlideId: to.id,
    motionBeatMs: options.motionBeatMs,
    durationMultiplier: options.durationMultiplier,
    durationMs,
    delayMs: options.delayMs,
    easing: options.easing,
    ...(options.inPreset ? { inPreset: options.inPreset } : {}),
    ...(options.outPreset ? { outPreset: options.outPreset } : {}),
    totalDurationMs: Math.max(
      options.delayMs + durationMs,
      ...operations.flatMap((operation) => operation.crossfadeTiming
        ? [
            operation.crossfadeTiming.from.delayMs + operation.crossfadeTiming.from.durationMs,
            operation.crossfadeTiming.to.delayMs + operation.crossfadeTiming.to.durationMs,
          ]
        : [operation.timing.delayMs + operation.timing.durationMs])
    ),
    operations
  };
};
