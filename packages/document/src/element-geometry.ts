import type { Anchor } from "./types.js";
import type { DeksElementState } from "./presentation.js";

export const DEFAULT_ANCHOR: Readonly<Anchor> = Object.freeze({ x: 0, y: 0 });

export function resolveAnchor(anchor?: Anchor): Anchor {
  return anchor ?? { x: DEFAULT_ANCHOR.x, y: DEFAULT_ANCHOR.y };
}

function assertAnchor(anchor: Anchor): void {
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)
    || anchor.x < 0 || anchor.x > 1 || anchor.y < 0 || anchor.y > 1) {
    throw new Error("anchor must be normalized between 0 and 1");
  }
}

/**
 * Changes an element state's pivot while preserving every rendered point.
 *
 * `x/y` move by `R(rotationDeg) * ((next - current) * {width,height})`.
 * Passing no next anchor returns to the legacy omitted top-left representation.
 */
export function reanchorElementState(state: DeksElementState, nextAnchor?: Anchor): DeksElementState {
  const current = resolveAnchor(state.anchor);
  const next = resolveAnchor(nextAnchor);
  assertAnchor(current);
  assertAnchor(next);
  const localX = (next.x - current.x) * state.width;
  const localY = (next.y - current.y) * state.height;
  const radians = state.rotationDeg * Math.PI / 180;
  const result: DeksElementState = {
    ...state,
    x: state.x + localX * Math.cos(radians) - localY * Math.sin(radians),
    y: state.y + localX * Math.sin(radians) + localY * Math.cos(radians),
  };
  if (nextAnchor === undefined) delete result.anchor;
  else result.anchor = { ...nextAnchor };
  return result;
}
