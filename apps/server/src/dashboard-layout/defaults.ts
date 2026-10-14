import type { DashboardLayout, PanelLayoutEntry } from "./types";
import { GRID_COLS, GRID_ROW_HEIGHT_PX, LAYOUT_VERSION } from "./types";

/** Panels that start collapsed in the default layout to save vertical space. */
export const DEFAULT_COLLAPSED_PANEL_IDS = new Set<string>([
  "calendar",
  "todoist",
  "recallio",
  "briefing",
  "host-health",
]);

/**
 * 14 tiles — News feeds is the hero tile (7×4). Low-priority integrations start collapsed on row 0.
 * The client scales row height to fit the dashboard viewport (no page scroll at 1280×800).
 */
export const DEFAULT_PANEL_LAYOUT: PanelLayoutEntry[] = [
  { id: "calendar", x: 0, y: 0, w: 2, h: 2, collapsed: true },
  { id: "todoist", x: 2, y: 0, w: 2, h: 2, collapsed: true },
  { id: "recallio", x: 4, y: 0, w: 2, h: 2, collapsed: true },
  { id: "host-health", x: 6, y: 0, w: 2, h: 2, collapsed: true },
  { id: "briefing", x: 8, y: 0, w: 2, h: 2, collapsed: true },
  { id: "activity", x: 0, y: 1, w: 3, h: 2 },
  { id: "hobie", x: 3, y: 1, w: 3, h: 2 },
  { id: "weather", x: 6, y: 1, w: 3, h: 2 },
  { id: "github", x: 9, y: 1, w: 3, h: 2 },
  { id: "feeds", x: 0, y: 3, w: 7, h: 4 },
  { id: "tagged-news", x: 7, y: 3, w: 5, h: 2 },
  { id: "daily-briefing", x: 7, y: 5, w: 5, h: 2 },
  { id: "ai-security", x: 7, y: 7, w: 5, h: 2 },
  { id: "notes", x: 0, y: 7, w: 7, h: 2 },
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
