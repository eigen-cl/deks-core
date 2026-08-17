import type {
  ElementTransitionMotion,
  ElementTransitionOverride,
  SlidePreset,
  SlideTransition,
} from "@deks-js/document";
import type {
  CompiledTransition,
  ElementSnapshot,
  ResolvedEasing,
  ResolvedTransitionTiming,
  SlideSnapshot,
  TransitionBehavior,
  TransitionOperation,
} from "./types.js";
import { cssCornerRadii } from "./corner-radii.js";

const MOTION_RATIOS = new Set([0.5, 0.75, 1, 1.5, 2]);
const PRESETS = new Set<SlidePreset>([
  "none", "fade", "glide-top", "glide-right", "glide-bottom", "glide-left",
]);

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function ratio(value: number, label: string): void {
  finite(value, label);
  if (!MOTION_RATIOS.has(value)) throw new Error(`${label} must be a supported motion ratio`);
}

function easing(options: SlideTransition): ResolvedEasing {
  if (options.easing !== "cubic-bezier") return options.easing;
  const values = options.bezier ?? [0.25, 0.1, 0.25, 1];
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("bezier must contain four finite values");
  }
  if (values[0] < 0 || values[0] > 1 || values[2] < 0 || values[2] > 1) {
    throw new Error("bezier x coordinates must be between zero and one");
  }
  return `cubic-bezier(${values.join(",")})`;
}

function validateSnapshot(snapshot: SlideSnapshot): void {
  finite(snapshot.canvas.width, "canvas.width");
  finite(snapshot.canvas.height, "canvas.height");
  if (snapshot.canvas.width <= 0 || snapshot.canvas.height <= 0) throw new Error("canvas dimensions must be positive");
  const ids = new Set<string>();
  for (const element of snapshot.elements) {
    if (ids.has(element.id)) throw new Error(`duplicate element id: ${element.id}`);
    ids.add(element.id);
    for (const [label, value] of Object.entries({
      x: element.rect.x,
      y: element.rect.y,
      width: element.rect.width,
      height: element.rect.height,
      rotationDeg: element.rotationDeg,
      opacity: element.opacity,
      zIndex: element.zIndex,
    })) finite(value, `${element.id}.${label}`);
    if (element.rect.width <= 0 || element.rect.height <= 0) throw new Error(`${element.id} width and height must be positive`);
    if (element.opacity < 0 || element.opacity > 1) throw new Error(`${element.id} opacity must be between zero and one`);
  }
}

function percent(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

/**
 * Same canvas-relative unit the renderer paints with. Keyframes must agree with
 * the mounted styles, or a transition would snap a radius or stroke between a
 * canvas-relative value and a viewport-absolute one on its first frame.
 */
function canvasLength(value: number, canvasWidth: number): string {
  return `${(value / canvasWidth) * 100}cqw`;
}

function keyframe(state: ElementSnapshot, canvas: SlideSnapshot["canvas"]): Keyframe {
  const frame: Keyframe = {
    left: percent(state.rect.x, canvas.width),
    top: percent(state.rect.y, canvas.height),
    width: percent(state.rect.width, canvas.width),
    height: percent(state.rect.height, canvas.height),
    transform: `rotate(${state.rotationDeg}deg)`,
    opacity: state.opacity,
  };
  if (state.kind === "text") Object.assign(frame, {
    color: state.color,
    fontSize: canvasLength(state.fontSize, canvas.width),
    fontWeight: state.fontWeight,
    letterSpacing: canvasLength(state.letterSpacing, canvas.width),
    lineHeight: state.lineHeight,
  });
  if (state.kind === "shape") {
    const fill = state.fillStyle;
    Object.assign(frame, {
      backgroundColor: state.shapeKind === "line" || fill?.kind === "linear-gradient"
        ? "transparent"
        : fill?.color ?? "transparent",
      backgroundImage: state.shapeKind !== "line" && fill?.kind === "linear-gradient"
        ? `linear-gradient(${fill.angleDeg}deg, ${fill.startColor}, ${fill.endColor})`
        : "none",
      borderColor: state.stroke ?? (state.shapeKind === "line" && fill?.kind === "solid" ? fill.color : "transparent"),
      borderWidth: canvasLength(state.strokeWidth ?? (state.shapeKind === "line" ? 2 : 0), canvas.width),
      borderRadius: state.shapeKind === "ellipse"
        ? "50%"
        : cssCornerRadii(state.cornerRadius, state.cornerRadii, canvas.width),
    });
  }
  if (state.kind === "link-button") Object.assign(frame, {
    backgroundColor: state.fill,
    color: state.textColor,
    fontSize: canvasLength(state.fontSize, canvas.width),
    fontWeight: state.fontWeight,
    borderColor: state.stroke ?? "transparent",
    borderWidth: canvasLength(state.strokeWidth ?? 0, canvas.width),
    borderRadius: canvasLength(state.cornerRadius, canvas.width),
  });
  if (state.kind === "icon") Object.assign(frame, { color: state.color });
  return frame;
}

function imageIdentity(state: Extract<ElementSnapshot, { kind: "image" }>): string {
  return state.assetId;
}

function hasDiscreteChange(from: ElementSnapshot, to: ElementSnapshot): boolean {
  if (from.kind !== to.kind) return true;
  if (from.kind === "text" && to.kind === "text") return from.content !== to.content
    || from.fontFamily !== to.fontFamily
    || from.horizontalAlignment !== to.horizontalAlignment
    || from.verticalAlignment !== to.verticalAlignment
    || from.overflowMode !== to.overflowMode;
  if (from.kind === "image" && to.kind === "image") return imageIdentity(from) !== imageIdentity(to)
    || from.fit !== to.fit || from.alt !== to.alt;
  if (from.kind === "shape" && to.kind === "shape") return from.shapeKind !== to.shapeKind
    || from.fillStyle?.kind !== to.fillStyle?.kind;
  if (from.kind === "link-button" && to.kind === "link-button") return from.label !== to.label
    || from.url !== to.url || from.fontFamily !== to.fontFamily;
  if (from.kind === "icon" && to.kind === "icon") return from.family !== to.family
    || from.iconName !== to.iconName || from.strokeWidth !== to.strokeWidth;
  return false;
}

function offCanvas(
  state: ElementSnapshot,
  preset: SlidePreset,
  canvas: SlideSnapshot["canvas"],
): ElementSnapshot {
  const rect = { ...state.rect };
  if (preset === "glide-top") rect.y = -rect.height;
  if (preset === "glide-right") rect.x = canvas.width;
  if (preset === "glide-bottom") rect.y = canvas.height;
  if (preset === "glide-left") rect.x = -rect.width;
  return { ...state, rect };
}

function matchingOverride(options: SlideTransition, elementId: string): ElementTransitionOverride | undefined {
  return options.overrides?.find((override) => override.elementId === elementId);
}

function matchingMotion(
  options: SlideTransition,
  elementId: string,
  direction: ElementTransitionMotion["direction"],
): ElementTransitionMotion | undefined {
  return options.elementMotions?.find((motion) => motion.elementId === elementId && motion.direction === direction);
}

function timing(
  options: SlideTransition,
  elementId: string,
  direction: "in" | "out" | "change",
  presetRatio: number,
  motion?: ElementTransitionMotion,
  preset?: SlidePreset,
): ResolvedTransitionTiming {
  const override = matchingOverride(options, elementId);
  const durationMultiplier = motion?.durationMultiplier ?? override?.durationMultiplier ?? presetRatio;
  ratio(durationMultiplier, `${elementId}.durationMultiplier`);
  const durationMs = override?.animate === false || preset === "none"
    ? 0
    : options.motionBeatMs * durationMultiplier;
  const delayMs = motion?.delayMs ?? override?.delayMs ?? options.delayMs;
  finite(delayMs, `${elementId}.delayMs`);
  if (delayMs < 0) throw new Error(`${elementId}.delayMs must not be negative`);
  return {
    durationMs,
    delayMs,
    easing: direction === "in" && motion ? "ease-out" : direction === "out" && motion ? "ease-in" : easing(options),
  };
}

function operation(
  id: string,
  from: ElementSnapshot | undefined,
  to: ElementSnapshot | undefined,
  fromSlide: SlideSnapshot,
  toSlide: SlideSnapshot,
  options: SlideTransition,
): TransitionOperation {
  const override = matchingOverride(options, id);
  const inMotion = matchingMotion(options, id, "in");
  const outMotion = matchingMotion(options, id, "out");
  const inPreset = inMotion?.preset ?? toSlide.inPreset ?? "fade";
  const outPreset = outMotion?.preset ?? fromSlide.outPreset ?? "fade";
  const inRatio = toSlide.inDurationMultiplier ?? options.durationMultiplier;
  const outRatio = fromSlide.outDurationMultiplier ?? options.durationMultiplier;
  const changeTiming = timing(options, id, "change", options.durationMultiplier);
  const forcedCut = override?.animate === false;

  if (from && to) {
    const fromFrame = keyframe(from, fromSlide.canvas);
    const toFrame = keyframe(to, toSlide.canvas);
    if (inMotion || outMotion) {
      const outgoing = offCanvas(from, outPreset, fromSlide.canvas);
      const incoming = offCanvas(to, inPreset, toSlide.canvas);
      const fromTiming = timing(options, id, "out", outRatio, outMotion, outPreset);
      const toTiming = timing(options, id, "in", inRatio, inMotion, inPreset);
      const cut = forcedCut || (outPreset === "none" && inPreset === "none");
      return {
        elementId: id,
        type: "change",
        from,
        to,
        keyframes: [fromFrame, toFrame],
        effectiveBehavior: cut ? "cut" : "fade",
        renderMode: cut ? "cut" : "crossfade",
        timing: changeTiming,
        crossfadeKeyframes: {
          from: [fromFrame, { ...keyframe(outgoing, fromSlide.canvas), opacity: 0 }],
          to: [{ ...keyframe(incoming, toSlide.canvas), opacity: 0 }, toFrame],
        },
        crossfadeTiming: { from: fromTiming, to: toTiming },
      };
    }
    const behavior: TransitionBehavior = forcedCut ? "cut" : hasDiscreteChange(from, to) ? "fade" : "morph";
    const renderMode = behavior === "cut" ? "cut" : behavior === "fade" ? "crossfade" : "single";
    return {
      elementId: id,
      type: "change",
      from,
      to,
      keyframes: [fromFrame, toFrame],
      effectiveBehavior: behavior,
      renderMode,
      timing: changeTiming,
      ...(renderMode === "crossfade" || renderMode === "cut" ? {
        crossfadeKeyframes: {
          from: [fromFrame, { ...fromFrame, opacity: 0 }],
          to: [{ ...toFrame, opacity: 0 }, toFrame],
        },
      } : {}),
    };
  }

  if (from) {
    const resolvedTiming = timing(options, id, "out", outRatio, outMotion, outPreset);
    const destination = offCanvas(from, outPreset, fromSlide.canvas);
    const cut = forcedCut || outPreset === "none";
    return {
      elementId: id,
      type: "exit",
      from,
      keyframes: [keyframe(from, fromSlide.canvas), { ...keyframe(destination, fromSlide.canvas), opacity: 0 }],
      effectiveBehavior: cut ? "cut" : "fade",
      renderMode: cut ? "cut" : "single",
      timing: resolvedTiming,
    };
  }

  if (!to) throw new Error("transition operation requires an endpoint");
  const resolvedTiming = timing(options, id, "in", inRatio, inMotion, inPreset);
  const origin = offCanvas(to, inPreset, toSlide.canvas);
  const cut = forcedCut || inPreset === "none";
  return {
    elementId: id,
    type: "enter",
    to,
    keyframes: [{ ...keyframe(origin, toSlide.canvas), opacity: 0 }, keyframe(to, toSlide.canvas)],
    effectiveBehavior: cut ? "cut" : "fade",
    renderMode: cut ? "cut" : "single",
    timing: resolvedTiming,
  };
}

function validateOptions(options: SlideTransition, from: SlideSnapshot, to: SlideSnapshot): "forward" | "reverse" {
  const orientation = options.fromSlideId === from.id && options.toSlideId === to.id
    ? "forward"
    : options.fromSlideId === to.id && options.toSlideId === from.id
      ? "reverse"
      : undefined;
  if (!orientation) throw new Error("transition endpoints do not match snapshots");
  finite(options.motionBeatMs, "motionBeatMs");
  if (options.motionBeatMs <= 0) throw new Error("motionBeatMs must be positive");
  ratio(options.durationMultiplier, "durationMultiplier");
  finite(options.delayMs, "delayMs");
  if (options.delayMs < 0) throw new Error("delayMs must not be negative");
  easing(options);
  for (const [label, preset] of [["from.outPreset", from.outPreset], ["to.inPreset", to.inPreset]] as const) {
    if (preset !== undefined && !PRESETS.has(preset)) throw new Error(`${label} is invalid`);
  }
  const known = new Set([...from.elements, ...to.elements].map(({ id }) => id));
  for (const override of options.overrides ?? []) {
    if (!known.has(override.elementId)) throw new Error(`transition override references unknown element: ${override.elementId}`);
  }
  for (const motion of options.elementMotions ?? []) {
    if (!known.has(motion.elementId)) throw new Error(`element motion references unknown element: ${motion.elementId}`);
    if (!PRESETS.has(motion.preset)) throw new Error(`${motion.elementId}.preset is invalid`);
    ratio(motion.durationMultiplier, `${motion.elementId}.durationMultiplier`);
    finite(motion.delayMs, `${motion.elementId}.delayMs`);
    if (motion.delayMs < 0) throw new Error(`${motion.elementId}.delayMs must not be negative`);
  }
  return orientation;
}

export function compileTransition(
  from: SlideSnapshot,
  to: SlideSnapshot,
  options: SlideTransition,
): CompiledTransition {
  validateSnapshot(from);
  validateSnapshot(to);
  if (from.canvas.width !== to.canvas.width || from.canvas.height !== to.canvas.height) {
    throw new Error("transition endpoints must share canvas dimensions");
  }
  const orientation = validateOptions(options, from, to);
  const playbackOptions: SlideTransition = orientation === "forward" ? options : {
    ...options,
    fromSlideId: from.id,
    toSlideId: to.id,
    ...(options.elementMotions ? {
      elementMotions: options.elementMotions.map((motion) => ({
        ...motion,
        direction: motion.direction === "in" ? "out" : "in",
      })),
    } : {}),
  };
  const fromById = new Map(from.elements.map((element) => [element.id, element]));
  const toById = new Map(to.elements.map((element) => [element.id, element]));
  const ids = [...fromById.keys(), ...toById.keys()].filter((id, index, all) => all.indexOf(id) === index);
  const operations = ids.map((id) => operation(id, fromById.get(id), toById.get(id), from, to, playbackOptions));
  const durationMs = options.motionBeatMs * options.durationMultiplier;
  const resolvedEasing = easing(options);
  return {
    from,
    to,
    options,
    durationMs,
    delayMs: options.delayMs,
    easing: resolvedEasing,
    operations,
    totalDurationMs: Math.max(
      options.delayMs + durationMs,
      ...operations.flatMap((item) => item.crossfadeTiming
        ? [
            item.crossfadeTiming.from.delayMs + item.crossfadeTiming.from.durationMs,
            item.crossfadeTiming.to.delayMs + item.crossfadeTiming.to.durationMs,
          ]
        : [item.timing.delayMs + item.timing.durationMs]),
    ),
  };
}
