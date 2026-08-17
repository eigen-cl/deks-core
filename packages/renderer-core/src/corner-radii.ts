import type { CornerRadii } from "@deks-js/document";

/**
 * Corner radii are canvas-space lengths, so they are emitted relative to the
 * stage width (`cqw`) exactly like font sizes. A fixed `px` radius would keep
 * its size while the stage shrank, which is what made small embeds look far
 * more rounded than the same deck at full size.
 */
export function cssCornerRadii(
  cornerRadius = 0,
  cornerRadii: CornerRadii | undefined,
  canvasWidth: number,
): string {
  const relative = (value: number) => `${(value / canvasWidth) * 100}cqw`;
  if (cornerRadii === undefined) return relative(cornerRadius);
  return [
    cornerRadii.topLeft,
    cornerRadii.topRight,
    cornerRadii.bottomRight,
    cornerRadii.bottomLeft,
  ].map(relative).join(" ");
}
