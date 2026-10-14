import type { DashboardLayout, PanelLayoutEntry } from "./types";
import { GRID_COLS, GRID_ROW_HEIGHT_PX, LAYOUT_VERSION } from "./types";

/** 14 tiles in 8 logical rows; the UI scales row height to fill the viewport at default size. */
export const DEFAULT_PANEL_LAYOUT: PanelLayoutEntry[] = [
  { id: "activity", x: 0, y: 0, w: 3, h: 2 },
  { id: "hobie", x: 3, y: 0, w: 3, h: 2 },
  { id: "weather", x: 6, y: 0, w: 3, h: 2 },
  { id: "host-health", x: 9, y: 0, w: 3, h: 2 },
  { id: "calendar", x: 0, y: 2, w: 3, h: 2 },
  { id: "todoist", x: 3, y: 2, w: 3, h: 2 },
  { id: "github", x: 6, y: 2, w: 3, h: 2 },
  { id: "recallio", x: 9, y: 2, w: 3, h: 2 },
  { id: "tagged-news", x: 0, y: 4, w: 3, h: 2 },
  { id: "daily-briefing", x: 3, y: 4, w: 3, h: 2 },
  { id: "ai-security", x: 6, y: 4, w: 3, h: 2 },
  { id: "notes", x: 9, y: 4, w: 3, h: 2 },
  { id: "feeds", x: 0, y: 6, w: 6, h: 2 },
  { id: "briefing", x: 6, y: 6, w: 6, h: 2 },
];

const DEFAULT_BY_ID = new Map(DEFAULT_PANEL_LAYOUT.map((p) => [p.id, p]));

export function defaultDashboardLayout(panelIds?: readonly string[]): DashboardLayout {
  const order = panelIds ?? DEFAULT_PANEL_LAYOUT.map((p) => p.id);
  const panels = order.map((id) => {
    const entry = DEFAULT_BY_ID.get(id);
    return entry ? { ...entry } : { id, x: 0, y: 0, w: 3, h: 2 };
  });
  return {
    version: LAYOUT_VERSION,
    cols: GRID_COLS,
    rowHeight: GRID_ROW_HEIGHT_PX,
    panels,
  };
}

export function defaultEntryForPanel(id: string): PanelLayoutEntry {
  return DEFAULT_BY_ID.get(id) ? { ...DEFAULT_BY_ID.get(id)! } : { id, x: 0, y: 0, w: 3, h: 2 };
}
