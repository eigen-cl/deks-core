import type {
  MorphMotion,
  MotionPatch,
  MotionRole,
  MotionSpec,
  PresenceMotion,
} from "./types.js";
import type { DeksDocument, DeksSlide } from "./presentation.js";

/**
 * The motion every document starts from. A document always carries a complete
 * spec, so resolution never falls back to a value hidden inside the renderer:
 * what a reader sees in the JSON is what plays.
 */
export const DEFAULT_MOTION: MotionSpec = Object.freeze({
  in: Object.freeze({
    animation: Object.freeze({ kind: "fade" }),
    durationBeats: 1,
    delayBeats: 0,
    delayMs: 0,
    easing: "ease-out",
  }),
  out: Object.freeze({
    animation: Object.freeze({ kind: "fade" }),
    durationBeats: 1,
    delayBeats: 0,
    delayMs: 0,
    easing: "ease-in",
  }),
  morph: Object.freeze({
    animation: Object.freeze({ kind: "morph" }),
    durationBeats: 1,
    delayBeats: 0,
    delayMs: 0,
    easing: "ease-in-out",
  }),
}) as MotionSpec;

export const MOTION_ROLES: readonly MotionRole[] = Object.freeze(["in", "out", "morph"]);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function mergeRole<T extends PresenceMotion | MorphMotion>(base: T, ...patches: (Partial<T> | undefined)[]): T {
  const merged = { ...base } as unknown as Record<string, unknown>;
  for (const patch of patches) {
    if (!patch) continue;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return clone(merged as unknown as T);
}

/**
 * Merges a chain of patches over a complete spec, property by property. A slide
 * that only sets `in.easing` still inherits `in.durationBeats` from above.
 */
export function mergeMotion(base: MotionSpec, ...patches: (MotionPatch | undefined)[]): MotionSpec {
  return {
    in: mergeRole(base.in, ...patches.map((patch) => patch?.in)),
    out: mergeRole(base.out, ...patches.map((patch) => patch?.out)),
    morph: mergeRole(base.morph, ...patches.map((patch) => patch?.morph)),
  };
}

/** Motion for a slide with no element in mind: document ← slide. */
export function resolveSlideMotion(document: DeksDocument, slideId: string): MotionSpec {
  const slide = findSlide(document, slideId);
  return mergeMotion(document.motion, slide.motion);
}

/** Motion for one element on one slide: document ← slide ← element state. */
export function resolveElementMotion(
  document: DeksDocument,
  slideId: string,
  elementId: string,
): MotionSpec {
  const slide = findSlide(document, slideId);
  const state = slide.states.find((item) => item.elementId === elementId);
  if (!state) throw new Error(`element ${elementId} has no state on slide ${slideId}`);
  return mergeMotion(document.motion, slide.motion, state.motion);
}

function findSlide(document: DeksDocument, slideId: string): DeksSlide {
  const slide = document.slides.find(({ id }) => id === slideId);
  if (!slide) throw new Error(`slide ${slideId} is missing`);
  return slide;
}

/** Cross-runtime half-up rounding, so every host reports the same duration. */
export function effectiveDurationMs(motionBeatMs: number, durationBeats: number): number {
  return Math.floor(motionBeatMs * durationBeats + 0.5);
}

/**
 * The delay a role actually waits, in milliseconds.
 *
 * Two units on purpose, and they add. `delayBeats` is musical: one beat waits
 * exactly as long as a one-beat animation takes, so "start when the previous
 * one ends" stays true when the deck's tempo changes. `delayMs` is absolute,
 * for the offsets that are about a specific instant rather than about the
 * rhythm. Expressing a follow-on in milliseconds worked until someone edited
 * `motionBeatMs` and every chain silently fell out of step.
 */
export function effectiveDelayMs(motionBeatMs: number, delayBeats: number, delayMs: number): number {
  return Math.floor(motionBeatMs * delayBeats + 0.5) + delayMs;
}
