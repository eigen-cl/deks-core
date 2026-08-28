import { resolveAnchor, type Anchor } from "@deks-js/document";
import type { Rect } from "./types.js";

export function resolvedAnchor(anchor?: Anchor): Anchor {
  return resolveAnchor(anchor);
}

/** Converts authored pivot geometry to its unrotated top-left rectangle. */
export function positionedRect(rect: Rect, anchorValue?: Anchor): Rect {
  const anchor = resolvedAnchor(anchorValue);
  return {
    x: rect.x - anchor.x * rect.width,
    y: rect.y - anchor.y * rect.height,
    width: rect.width,
    height: rect.height,
  };
}

/** Axis-aligned canvas bounds after rotating the local box around its anchor. */
export function visualAabb(rect: Rect, degrees: number, anchorValue?: Anchor): Rect {
  const anchor = resolvedAnchor(anchorValue);
  const radians = degrees * Math.PI / 180;
  const rotate = (x: number, y: number) => ({
    x: rect.x + x * Math.cos(radians) - y * Math.sin(radians),
    y: rect.y + x * Math.sin(radians) + y * Math.cos(radians),
  });
  const left = -anchor.x * rect.width;
  const top = -anchor.y * rect.height;
  const corners = [
    rotate(left, top),
    rotate(left + rect.width, top),
    rotate(left, top + rect.height),
    rotate(left + rect.width, top + rect.height),
  ];
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
