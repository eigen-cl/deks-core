import type {
  Easing,
  MorphMotion,
  MotionEdge,
  PresenceAnimation,
  PresenceMotion,
} from "@deks-js/document";
import { effectiveDelayMs, effectiveDurationMs } from "@deks-js/document";
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
import { validateSnapshot } from "./validation.js";

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

/**
 * Where a wipe starts (entering) or ends (leaving). Nothing moves: the element
 * stays exactly where it is and the mask edge travels across it, uncovering it
 * from `edge` and covering it again on the way out. `inset()` is resolved in the
 * element's own border box, before its transform, so a rotated element is wiped
 * along its own axis.
 */
function wipeKeyframes(edge: MotionEdge, direction: "in" | "out"): [Keyframe, Keyframe] {
  const covered = { clipPath: {
    left: "inset(0 100% 0 0)",
    right: "inset(0 0 0 100%)",
    top: "inset(0 0 100% 0)",
    bottom: "inset(100% 0 0 0)",
  }[edge] };
  const uncovered = { clipPath: "inset(0 0 0 0)" };
  return direction === "in" ? [covered, uncovered] : [uncovered, covered];
}

/**
 * Where a crop starts (entering) or ends (leaving). The element rectangle is the
 * mask and never moves; only the content inside it travels, by exactly the
 * element's own extent on that axis. Opacity is deliberately untouched: that is
 * what lets one text replace another in the same place without the two of them
 * dissolving through each other.
 */
function cropKeyframes(edge: MotionEdge, direction: "in" | "out"): [Keyframe, Keyframe] {
  const displaced = { transform: {
    left: "translate(-100%, 0)",
    right: "translate(100%, 0)",
    top: "translate(0, -100%)",
    bottom: "translate(0, 100%)",
  }[edge] };
  const rest = { transform: "translate(0, 0)" };
  return direction === "in" ? [displaced, rest] : [rest, displaced];
}

function cropOf(animation: PresenceAnimation, direction: "in" | "out"): TransitionOperation["crop"] {
  if (animation.kind !== "crop") return undefined;
  return { edge: animation.edge, keyframes: cropKeyframes(animation.edge, direction) };
}

function wipeOf(animation: PresenceAnimation, direction: "in" | "out"): TransitionOperation["wipe"] {
  if (animation.kind !== "wipe") return undefined;
  return { edge: animation.edge, keyframes: wipeKeyframes(animation.edge, direction) };
}

/**
 * The magnitude a number counts through in this role, or nothing when the
 * element is not a number or its identity leaves that role switched off.
 * Entering counts up from zero and leaving counts down to zero: the origin is
 * the absence of the figure, which is what the audience is watching change.
 */
function magnitude(
  role: "in" | "out" | "morph",
  from: ElementSnapshot | undefined,
  to: ElementSnapshot | undefined,
): { from: number; to: number } | undefined {
  const owner = role === "out" ? from : to;
  if (owner?.kind !== "number" || !owner.animateMagnitude[role]) return undefined;
  if (role === "in") return { from: 0, to: owner.value };
  if (role === "out") return { from: owner.value, to: 0 };
  if (from?.kind !== "number") return undefined;
  if (from.value === owner.value) return undefined;
  return { from: from.value, to: owner.value };
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
  if (state.kind === "text" || state.kind === "number") Object.assign(frame, {
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
  if (from.kind === "number" && to.kind === "number") {
    // A counting number is the opposite of a discrete change: it interpolates,
    // so it must not be crossfaded between two magnitudes.
    const counts = to.animateMagnitude.morph;
    return from.fontFamily !== to.fontFamily
      || from.horizontalAlignment !== to.horizontalAlignment
      || from.verticalAlignment !== to.verticalAlignment
      || from.symbol !== to.symbol
      || from.symbolPosition !== to.symbolPosition
      || from.decimals !== to.decimals
      || from.groupSeparator !== to.groupSeparator
      || from.decimalSeparator !== to.decimalSeparator
      || (!counts && from.value !== to.value);
  }
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
    // The two units add: musical beats keep a follow-on aligned when the tempo
    // changes, milliseconds pin an offset that is about a specific instant.
    delayMs: effectiveDelayMs(motionBeatMs, motion.delayBeats, motion.delayMs),
    easing: resolveEasing(motion.easing, "easing"),
  };
}

function enterOperation(to: ElementSnapshot, canvas: SlideSnapshot["canvas"], motionBeatMs: number): TransitionOperation {
  const motion = to.motion.in;
  const cut = motion.animation.kind === "none";
  const crop = cropOf(motion.animation, "in");
  const wipe = wipeOf(motion.animation, "in");
  const origin = displaced(to, motion.animation, canvas);
  const counted = magnitude("in", undefined, to);
  return {
    elementId: to.id,
    type: "enter",
    to,
    keyframes: [
      // A crop reveals rather than fades: dropping opacity would reintroduce
      // exactly the mush the mask exists to avoid.
      { ...keyframe(origin, canvas, presenceScale(motion.animation)), ...(crop || wipe ? {} : { opacity: 0 }) },
      keyframe(to, canvas),
    ],
    effectiveBehavior: cut ? "cut" : "fade",
    renderMode: cut ? "cut" : "single",
    timing: timing(motion, motionBeatMs),
    ...(crop ? { crop } : {}),
    ...(wipe ? { wipe } : {}),
    ...(counted && !cut ? { magnitude: counted } : {}),
  };
}

function exitOperation(from: ElementSnapshot, canvas: SlideSnapshot["canvas"], motionBeatMs: number): TransitionOperation {
  const motion = from.motion.out;
  const cut = motion.animation.kind === "none";
  const crop = cropOf(motion.animation, "out");
  const wipe = wipeOf(motion.animation, "out");
  const destination = displaced(from, motion.animation, canvas);
  const counted = magnitude("out", from, undefined);
  return {
    elementId: from.id,
    type: "exit",
    from,
    keyframes: [
      keyframe(from, canvas),
      { ...keyframe(destination, canvas, presenceScale(motion.animation)), ...(crop || wipe ? {} : { opacity: 0 }) },
    ],
    effectiveBehavior: cut ? "cut" : "fade",
    renderMode: cut ? "cut" : "single",
    timing: timing(motion, motionBeatMs),
    ...(crop ? { crop } : {}),
    ...(wipe ? { wipe } : {}),
    ...(counted && !cut ? { magnitude: counted } : {}),
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
    // A cut lands on the final value immediately: counting fast is not the same
    // thing as not counting.
    ...(cut ? {} : (() => {
      const counted = magnitude("morph", from, to);
      return counted ? { magnitude: counted } : {};
    })()),
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
    delayMs: effectiveDelayMs(to.motionBeatMs, boundary.delayBeats, boundary.delayMs),
    easing: resolveEasing(boundary.easing, "motion.morph.easing"),
    operations,
    totalDurationMs: Math.max(
      effectiveDelayMs(to.motionBeatMs, boundary.delayBeats, boundary.delayMs) + durationMs,
      ...operations.map((item) => item.timing.delayMs + item.timing.durationMs),
    ),
  };
}
