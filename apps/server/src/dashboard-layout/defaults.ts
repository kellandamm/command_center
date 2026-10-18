import type { DashboardLayout, PanelLayoutEntry } from "./types";
import { GRID_COLS, GRID_ROW_HEIGHT_PX, LAYOUT_VERSION } from "./types";

/** Panels that start collapsed in the default layout to save vertical space. */
export const DEFAULT_COLLAPSED_PANEL_IDS = new Set<string>([
  "calendar",
  "recallio",
  "host-health",
  "notes",
]);

/** Compact layout for the remaining personal dashboard panels. */
export const DEFAULT_PANEL_LAYOUT: PanelLayoutEntry[] = [
  { id: "calendar", x: 0, y: 0, w: 2, h: 2, collapsed: true },
  { id: "recallio", x: 2, y: 0, w: 2, h: 2, collapsed: true },
  { id: "host-health", x: 4, y: 0, w: 2, h: 2, collapsed: true },
  { id: "activity", x: 0, y: 1, w: 3, h: 2 },
  { id: "hobie", x: 3, y: 1, w: 3, h: 2 },
  { id: "weather", x: 6, y: 1, w: 3, h: 2 },
  { id: "daily-briefing", x: 0, y: 3, w: 6, h: 2 },
  { id: "notes", x: 6, y: 3, w: 4, h: 2, collapsed: true },
];

const DEFAULT_BY_ID = new Map(DEFAULT_PANEL_LAYOUT.map((p) => [p.id, p]));

function withDefaultCollapsed(entry: PanelLayoutEntry): PanelLayoutEntry {
  if (entry.collapsed || !DEFAULT_COLLAPSED_PANEL_IDS.has(entry.id)) return entry;
  return { ...entry, collapsed: true };
}

export function defaultDashboardLayout(panelIds?: readonly string[]): DashboardLayout {
  const order = panelIds ?? DEFAULT_PANEL_LAYOUT.map((p) => p.id);
  const panels = order.map((id) => {
    const entry = DEFAULT_BY_ID.get(id);
    return entry ? { ...entry } : withDefaultCollapsed({ id, x: 0, y: 0, w: 3, h: 2 });
  });
  return {
    version: LAYOUT_VERSION,
    cols: GRID_COLS,
    rowHeight: GRID_ROW_HEIGHT_PX,
    panels,
  };
}

export function defaultEntryForPanel(id: string): PanelLayoutEntry {
  const entry = DEFAULT_BY_ID.get(id);
  if (entry) return { ...entry };
  return withDefaultCollapsed({ id, x: 0, y: 0, w: 3, h: 2 });
}
