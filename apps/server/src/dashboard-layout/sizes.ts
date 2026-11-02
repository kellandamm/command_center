import type { WidgetSize } from "./schema";

export const SIZE_DIMS: Record<WidgetSize, { w: number; h: number }> = {
  S: { w: 3, h: 1 },
  W: { w: 6, h: 1 },
  L: { w: 6, h: 2 },
  XL: { w: 12, h: 2 },
};

export function inferSizeFromLegacy(w: number, h: number): WidgetSize {
  if (w >= 12 && h >= 2) return "XL";
  if (w >= 6 && h >= 2) return "L";
  if (w >= 6) return "W";
  return "S";
}
