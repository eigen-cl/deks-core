import type { ElementSnapshot, Rect, SlideSnapshot } from "./types.js";

export interface ElementFrame {
  rect: Rect;
  rotationDeg: number;
  opacity: number;
}

export function frameFromSnapshot(state: ElementSnapshot): ElementFrame {
  return {
    rect: { ...state.rect },
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
  ];
  if (!values.every(Number.isFinite)) throw new Error("preview geometry, rotation, and opacity must be finite");
  if (frame.rect.width <= 0 || frame.rect.height <= 0) {
    throw new Error("preview width and height must be positive");
  }
  if (frame.opacity < 0 || frame.opacity > 1) {
    throw new Error("preview opacity must be between 0 and 1");
  }
}

export function applyElementFrame(node: HTMLElement, frame: ElementFrame, canvas: SlideSnapshot["canvas"]): void {
  validateElementFrame(frame);
  Object.assign(node.style, {
    left: `${(frame.rect.x / canvas.width) * 100}%`,
    top: `${(frame.rect.y / canvas.height) * 100}%`,
    width: `${(frame.rect.width / canvas.width) * 100}%`,
    height: `${(frame.rect.height / canvas.height) * 100}%`,
    transform: `rotate(${frame.rotationDeg}deg)`,
    opacity: String(frame.opacity),
  });
  node.style.setProperty("--deks-x", `${frame.rect.x}px`);
  node.style.setProperty("--deks-y", `${frame.rect.y}px`);
  node.style.setProperty("--deks-width", `${frame.rect.width}px`);
  node.style.setProperty("--deks-height", `${frame.rect.height}px`);
  node.style.setProperty("--deks-rotation", `${frame.rotationDeg}deg`);
  node.style.setProperty("--deks-opacity", String(frame.opacity));
}
