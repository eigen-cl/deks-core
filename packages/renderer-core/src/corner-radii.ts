import type { CornerRadii } from "./types.js";

export const cornerRadiusCss = (cornerRadii?: CornerRadii): string => cornerRadii
  ? `${cornerRadii.topLeft}px ${cornerRadii.topRight}px ${cornerRadii.bottomRight}px ${cornerRadii.bottomLeft}px`
  : "0px";

export const cornerRadiusValues = (cornerRadii?: CornerRadii): number[] => cornerRadii
  ? [cornerRadii.topLeft, cornerRadii.topRight, cornerRadii.bottomRight, cornerRadii.bottomLeft]
  : [0];
