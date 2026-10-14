import { ValidationError } from "../settings";
import { defaultEntryForPanel } from "./defaults";
import { maxOccupiedRow } from "./pack";
import type { DashboardLayout, PanelLayoutEntry } from "./types";
import { GRID_COLS, GRID_ROW_HEIGHT_PX, LAYOUT_VERSION } from "./types";

function clampInt(n: number, min: number, max: number, field: string): number {
  if (!Number.isFinite(n) || Math.floor(n) !== n) throw new ValidationError(`${field} must be an integer`);
  if (n < min || n > max) throw new ValidationError(`${field} must be between ${min} and ${max}`);
  return n;
}

function normalizeEntry(raw: PanelLayoutEntry, knownIds: Set<string>): PanelLayoutEntry {
  if (!knownIds.has(raw.id)) throw new ValidationError(`unknown panel id: ${raw.id}`);
  const collapsed = Boolean(raw.collapsed);
  const w = clampInt(raw.w, 2, GRID_COLS, `panel ${raw.id} width`);
  const h = clampInt(raw.h, 2, 24, `panel ${raw.id} height`);
  const x = clampInt(raw.x, 0, GRID_COLS - w, `panel ${raw.id} x`);
  const y = clampInt(raw.y, 0, 200, `panel ${raw.id} y`);
  return {
    id: raw.id,
    x,
    y,
    w,
    h,
    ...(collapsed ? { collapsed: true } : {}),
  };
}

function mergeSavedPanels(
  body: { panels?: unknown; rowHeight?: number },
  panelIds: readonly string[],
): DashboardLayout {
  const known = new Set(panelIds);
  const byId = new Map<string, PanelLayoutEntry>();

  if (Array.isArray(body.panels)) {
    for (const entry of body.panels) {
      if (!entry || typeof entry !== "object" || typeof (entry as PanelLayoutEntry).id !== "string") continue;
      const id = (entry as PanelLayoutEntry).id;
      if (!known.has(id)) continue;
      try {
        byId.set(id, normalizeEntry(entry as PanelLayoutEntry, known));
      } catch {
        byId.set(id, defaultEntryForPanel(id));
      }
    }
  }

  for (const id of panelIds) {
    if (byId.has(id)) continue;
    const entry = defaultEntryForPanel(id);
    const y = maxOccupiedRow(Array.from(byId.values()));
    byId.set(id, { ...entry, x: 0, y });
  }

  const panels = panelIds.map((id) => byId.get(id)!);
  return {
    version: LAYOUT_VERSION,
    cols: GRID_COLS,
    rowHeight: GRID_ROW_HEIGHT_PX,
    panels,
  };
}

/** Merge saved layout with the current panel registry (add missing, drop stale). */
export function normalizeDashboardLayout(raw: unknown, panelIds: readonly string[]): DashboardLayout {
  if (!raw || typeof raw !== "object") throw new ValidationError("layout must be an object");
  const body = raw as DashboardLayout;
  if (body.version !== LAYOUT_VERSION) {
    return mergeSavedPanels(body, panelIds);
  }
  if (!Array.isArray(body.panels)) throw new ValidationError("layout.panels must be an array");
  return mergeSavedPanels(body, panelIds);
}
