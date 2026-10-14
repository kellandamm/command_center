import type { DashboardLayout, PanelLayoutEntry } from "./types";
import { GRID_COLS, GRID_ROW_HEIGHT_PX, LAYOUT_VERSION } from "./types";

/** Compact mosaic: all panels within ~11 grid rows (~400px) on a laptop viewport. */
export const DEFAULT_PANEL_LAYOUT: PanelLayoutEntry[] = [
  { id: "activity", x: 0, y: 0, w: 3, h: 3 },
  { id: "hobie", x: 3, y: 0, w: 3, h: 3 },
  { id: "weather", x: 6, y: 0, w: 3, h: 3 },
  { id: "host-health", x: 9, y: 0, w: 3, h: 3 },
  { id: "calendar", x: 0, y: 3, w: 3, h: 4 },
  { id: "todoist", x: 3, y: 3, w: 3, h: 4 },
  { id: "github", x: 6, y: 3, w: 3, h: 4 },
  { id: "recallio", x: 9, y: 3, w: 3, h: 4 },
  { id: "notes", x: 0, y: 7, w: 4, h: 4 },
  { id: "feeds", x: 4, y: 7, w: 4, h: 4 },
  { id: "briefing", x: 8, y: 7, w: 4, h: 4 },
];

const DEFAULT_BY_ID = new Map(DEFAULT_PANEL_LAYOUT.map((p) => [p.id, p]));

export function defaultDashboardLayout(panelIds?: readonly string[]): DashboardLayout {
  const order = panelIds ?? DEFAULT_PANEL_LAYOUT.map((p) => p.id);
  const panels = order.map((id) => {
    const entry = DEFAULT_BY_ID.get(id);
    return entry ? { ...entry } : { id, x: 0, y: 0, w: 4, h: 3 };
  });
  return {
    version: LAYOUT_VERSION,
    cols: GRID_COLS,
    rowHeight: GRID_ROW_HEIGHT_PX,
    panels,
  };
}
