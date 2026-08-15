import type { CornerRadii } from "@deks-js/document";

export function cssCornerRadii(cornerRadius = 0, cornerRadii?: CornerRadii): string {
  if (cornerRadii === undefined) return `${cornerRadius}px`;
  return [
    cornerRadii.topLeft,
    cornerRadii.topRight,
    cornerRadii.bottomRight,
    cornerRadii.bottomLeft,
  ].map((value) => `${value}px`).join(" ");
}
