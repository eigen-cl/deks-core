import type { Anchor } from "@deks-js/document";
import type { ElementSnapshot, Rect, SlideSnapshot } from "./types.js";
import { positionedRect, resolvedAnchor } from "./geometry.js";

export interface ElementFrame {
  rect: Rect;
  anchor?: Anchor;
  rotationDeg: number;
  opacity: number;
}

export function frameFromSnapshot(state: ElementSnapshot): ElementFrame {
  return {
    rect: { ...state.rect },
    ...(state.anchor === undefined ? {} : { anchor: { ...state.anchor } }),
    rotationDeg: state.rotationDeg,
    opacity: state.opacity,
  };
}

export function validateElementFrame(frame: ElementFrame): void {
  const values = [
    frame.rect.x,
    frame.rect.y,
    frame.rect.width,
    frame.rect.height,
    frame.rotationDeg,
    frame.opacity,
    frame.anchor?.x ?? 0,
    frame.anchor?.y ?? 0,
  ];
  if (!values.every(Number.isFinite)) throw new Error("preview geometry, rotation, and opacity must be finite");
  if (frame.rect.width <= 0 || frame.rect.height <= 0) {
    throw new Error("preview width and height must be positive");
  }
  if (frame.opacity < 0 || frame.opacity > 1) {
    throw new Error("preview opacity must be between 0 and 1");
  }
  if (frame.anchor && (frame.anchor.x < 0 || frame.anchor.x > 1 || frame.anchor.y < 0 || frame.anchor.y > 1)) {
    throw new Error("preview anchor must be normalized between 0 and 1");
  }
}

export function applyElementFrame(node: HTMLElement, frame: ElementFrame, canvas: SlideSnapshot["canvas"]): void {
  validateElementFrame(frame);
  const anchor = resolvedAnchor(frame.anchor);
  const box = positionedRect(frame.rect, frame.anchor);
  Object.assign(node.style, {
    left: `${(box.x / canvas.width) * 100}%`,
    top: `${(box.y / canvas.height) * 100}%`,
    width: `${(frame.rect.width / canvas.width) * 100}%`,
    height: `${(frame.rect.height / canvas.height) * 100}%`,
    transform: `rotate(${frame.rotationDeg}deg)`,
    transformOrigin: `${anchor.x * 100}% ${anchor.y * 100}%`,
    opacity: String(frame.opacity),
  });
  node.style.setProperty("--deks-x", `${frame.rect.x}px`);
  node.style.setProperty("--deks-y", `${frame.rect.y}px`);
  node.style.setProperty("--deks-width", `${frame.rect.width}px`);
  node.style.setProperty("--deks-height", `${frame.rect.height}px`);
  node.style.setProperty("--deks-rotation", `${frame.rotationDeg}deg`);
  node.style.setProperty("--deks-opacity", String(frame.opacity));
}
