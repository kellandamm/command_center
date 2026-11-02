import type { DashboardLayoutV3, WidgetLayoutEntry } from "./schema";
import { LAYOUT_VERSION } from "./schema";

export { LAYOUT_VERSION };
export { GRID_COLS, GRID_ROW_HEIGHT_PX, GRID_GAP_PX } from "./types-legacy";

/** Grid placement derived from ordered widgets (client + SSR). */
export interface PanelLayoutEntry {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: import("./schema").WidgetSize;
  config?: Record<string, unknown>;
}

export interface DashboardLayout extends DashboardLayoutV3 {
  /** Derived grid cells in display order. */
  panels: PanelLayoutEntry[];
}

export function layoutFromWidgets(widgets: WidgetLayoutEntry[], panels: PanelLayoutEntry[]): DashboardLayout {
  return { version: LAYOUT_VERSION, widgets, panels };
}
