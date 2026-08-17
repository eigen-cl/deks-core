import type {
  Easing,
  MorphMotion,
  PresenceAnimation,
  PresenceMotion,
} from "@deks-js/document";
import { effectiveDurationMs } from "@deks-js/document";
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

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function beats(value: number, label: string): void {
  finite(value, label);
  if (value < 0) throw new Error(`${label} must not be negative`);
}

function resolveEasing(value: Easing, label: string): ResolvedEasing {
  if (typeof value === "string") return value;
  if (!Array.isArray(value) || value.length !== 4 || value.some((part) => !Number.isFinite(part))) {
    throw new Error(`${label} must be a named curve or four finite bezier controls`);
  }
  if (value[0] < 0 || value[0] > 1 || value[2] < 0 || value[2] > 1) {
    throw new Error(`${label} x coordinates must be between zero and one`);
  }
  return `cubic-bezier(${value.join(",")})`;
}

function validateSnapshot(snapshot: SlideSnapshot): void {
  finite(snapshot.canvas.width, "canvas.width");
  finite(snapshot.canvas.height, "canvas.height");
  if (snapshot.canvas.width <= 0 || snapshot.canvas.height <= 0) throw new Error("canvas dimensions must be positive");
  finite(snapshot.motionBeatMs, "motionBeatMs");
  if (snapshot.motionBeatMs <= 0) throw new Error("motionBeatMs must be positive");
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
    for (const role of ["in", "out", "morph"] as const) {
      const motion = element.motion[role];
      beats(motion.durationBeats, `${element.id}.motion.${role}.durationBeats`);
      finite(motion.delayMs, `${element.id}.motion.${role}.delayMs`);
      if (motion.delayMs < 0) throw new Error(`${element.id}.motion.${role}.delayMs must not be negative`);
      resolveEasing(motion.easing, `${element.id}.motion.${role}.easing`);
    }
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

function keyframe(state: ElementSnapshot, canvas: SlideSnapshot["canvas"], scale = 1): Keyframe {
  const frame: Keyframe = {
    left: percent(state.rect.x, canvas.width),
    top: percent(state.rect.y, canvas.height),
    width: percent(state.rect.width, canvas.width),
    height: percent(state.rect.height, canvas.height),
    transform: scale === 1
      ? `rotate(${state.rotationDeg}deg)`
      : `rotate(${state.rotationDeg}deg) scale(${scale})`,
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

/**
 * Where a presence animation starts (entering) or ends (leaving). Without an
 * explicit distance the element travels until it is completely off the canvas.
 */
function displaced(
  state: ElementSnapshot,
  animation: PresenceAnimation,
  canvas: SlideSnapshot["canvas"],
): ElementSnapshot {
  if (animation.kind !== "slide") return state;
  const rect = { ...state.rect };
  const { distance } = animation;
  if (animation.edge === "left") rect.x = distance === undefined ? -rect.width : rect.x - distance;
  if (animation.edge === "right") rect.x = distance === undefined ? canvas.width : rect.x + distance;
  if (animation.edge === "top") rect.y = distance === undefined ? -rect.height : rect.y - distance;
  if (animation.edge === "bottom") rect.y = distance === undefined ? canvas.height : rect.y + distance;
  return { ...state, rect };
}

function presenceScale(animation: PresenceAnimation): number {
  return animation.kind === "scale" ? animation.from : 1;
}

function timing(motion: PresenceMotion | MorphMotion, motionBeatMs: number): ResolvedTransitionTiming {
  const still = motion.animation.kind === "none" || motion.animation.kind === "cut";
  return {
    durationMs: still ? 0 : effectiveDurationMs(motionBeatMs, motion.durationBeats),
    delayMs: motion.delayMs,
    easing: resolveEasing(motion.easing, "easing"),
  };
}

function enterOperation(to: ElementSnapshot, canvas: SlideSnapshot["canvas"], motionBeatMs: number): TransitionOperation {
  const motion = to.motion.in;
  const cut = motion.animation.kind === "none";
  const origin = displaced(to, motion.animation, canvas);
  return {
    elementId: to.id,
    type: "enter",
    to,
    keyframes: [
      { ...keyframe(origin, canvas, presenceScale(motion.animation)), opacity: 0 },
      keyframe(to, canvas),
    ],
    effectiveBehavior: cut ? "cut" : "fade",
    renderMode: cut ? "cut" : "single",
    timing: timing(motion, motionBeatMs),
  };
}

function exitOperation(from: ElementSnapshot, canvas: SlideSnapshot["canvas"], motionBeatMs: number): TransitionOperation {
  const motion = from.motion.out;
  const cut = motion.animation.kind === "none";
  const destination = displaced(from, motion.animation, canvas);
  return {
    elementId: from.id,
    type: "exit",
    from,
    keyframes: [
      keyframe(from, canvas),
      { ...keyframe(destination, canvas, presenceScale(motion.animation)), opacity: 0 },
    ],
    effectiveBehavior: cut ? "cut" : "fade",
    renderMode: cut ? "cut" : "single",
    timing: timing(motion, motionBeatMs),
  };
}

/**
 * An element on both slides plays its `morph`, resolved from the slide it is
 * arriving at. Content that cannot interpolate (different text, another image)
 * crossfades between the two states instead of morphing a single node.
 */
function changeOperation(
  from: ElementSnapshot,
  to: ElementSnapshot,
  fromCanvas: SlideSnapshot["canvas"],
  toCanvas: SlideSnapshot["canvas"],
  motionBeatMs: number,
): TransitionOperation {
  const motion = to.motion.morph;
  const cut = motion.animation.kind === "cut";
  const behavior: TransitionBehavior = cut ? "cut" : hasDiscreteChange(from, to) ? "fade" : "morph";
  const renderMode = behavior === "cut" ? "cut" : behavior === "fade" ? "crossfade" : "single";
  const fromFrame = keyframe(from, fromCanvas);
  const toFrame = keyframe(to, toCanvas);
  return {
    elementId: to.id,
    type: "change",
    from,
    to,
    keyframes: [fromFrame, toFrame],
    effectiveBehavior: behavior,
    renderMode,
    timing: timing(motion, motionBeatMs),
    ...(renderMode === "crossfade" || renderMode === "cut" ? {
      crossfadeKeyframes: {
        from: [fromFrame, { ...fromFrame, opacity: 0 }],
        to: [{ ...toFrame, opacity: 0 }, toFrame],
      },
    } : {}),
  };
}

/**
 * Compiles the boundary between two slides. Everything the boundary needs is
 * already resolved inside the snapshots: an element leaving plays the `out` of
 * the slide it leaves, and an element arriving or persisting plays the `in` or
 * `morph` of the slide it arrives at. Playing backwards is the same call with
 * the snapshots swapped.
 */
export function compileTransition(from: SlideSnapshot, to: SlideSnapshot): CompiledTransition {
  validateSnapshot(from);
  validateSnapshot(to);
  if (from.canvas.width !== to.canvas.width || from.canvas.height !== to.canvas.height) {
    throw new Error("transition endpoints must share canvas dimensions");
  }
  const fromById = new Map(from.elements.map((element) => [element.id, element]));
  const toById = new Map(to.elements.map((element) => [element.id, element]));
  const ids = [...fromById.keys(), ...toById.keys()].filter((id, index, all) => all.indexOf(id) === index);
  const operations = ids.map((id) => {
    const before = fromById.get(id);
    const after = toById.get(id);
    if (before && after) return changeOperation(before, after, from.canvas, to.canvas, to.motionBeatMs);
    if (before) return exitOperation(before, from.canvas, from.motionBeatMs);
    if (after) return enterOperation(after, to.canvas, to.motionBeatMs);
    throw new Error("transition operation requires an endpoint");
  });
  const boundary = to.motion.morph;
  const durationMs = boundary.animation.kind === "cut"
    ? 0
    : effectiveDurationMs(to.motionBeatMs, boundary.durationBeats);
  return {
    from,
    to,
    durationMs,
    delayMs: boundary.delayMs,
    easing: resolveEasing(boundary.easing, "motion.morph.easing"),
    operations,
    totalDurationMs: Math.max(
      boundary.delayMs + durationMs,
      ...operations.map((item) => item.timing.delayMs + item.timing.durationMs),
    ),
  };
}
