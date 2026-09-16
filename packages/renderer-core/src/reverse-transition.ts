import type { CompiledTransition, ResolvedEasing, ResolvedTransitionTiming, TransitionOperation } from "./types.js";

function reverseEasing(easing: ResolvedEasing): ResolvedEasing {
  if (easing === "ease-in") return "ease-out";
  if (easing === "ease-out") return "ease-in";
  if (easing === "linear" || easing === "ease-in-out") return easing;
  const [x1, y1, x2, y2] = easing.slice(13, -1).split(",").map(Number) as [number, number, number, number];
  return `cubic-bezier(${1 - x2},${1 - y2},${1 - x1},${1 - y1})`;
}

function reverseTiming(timing: ResolvedTransitionTiming, total: number): ResolvedTransitionTiming {
  return {
    durationMs: timing.durationMs,
    delayMs: Math.max(0, total - timing.delayMs - timing.durationMs),
    easing: reverseEasing(timing.easing),
  };
}

const reverseFrames = ([first, last]: [Keyframe, Keyframe]): [Keyframe, Keyframe] => [last, first];

/** Invert resolved effects, never re-resolve the opposite authored presence roles. */
export function reverseTransition(forward: CompiledTransition): CompiledTransition {
  const total = forward.totalDurationMs;
  return {
    ...forward,
    direction: "reverse",
    from: forward.to,
    to: forward.from,
    ...reverseTiming(forward, total),
    operations: forward.operations.map((operation): TransitionOperation => {
      const { from, to, crop, wipe, magnitude, crossfadeKeyframes, crossfadeTiming, ...rest } = operation;
      return {
        ...rest,
        type: operation.type === "enter" ? "exit" : operation.type === "exit" ? "enter" : "change",
        ...(to ? { from: to } : {}),
        ...(from ? { to: from } : {}),
        keyframes: reverseFrames(operation.keyframes),
        timing: reverseTiming(operation.timing, total),
        ...(crop ? { crop: { ...crop, keyframes: reverseFrames(crop.keyframes) } } : {}),
        ...(wipe ? { wipe: { ...wipe, keyframes: reverseFrames(wipe.keyframes) } } : {}),
        ...(magnitude ? { magnitude: { from: magnitude.to, to: magnitude.from } } : {}),
        ...(crossfadeKeyframes ? { crossfadeKeyframes: {
          from: reverseFrames(crossfadeKeyframes.to),
          to: reverseFrames(crossfadeKeyframes.from),
        } } : {}),
        ...(crossfadeTiming ? { crossfadeTiming: {
          from: reverseTiming(crossfadeTiming.to, total),
          to: reverseTiming(crossfadeTiming.from, total),
        } } : {}),
      };
    }),
  };
}
