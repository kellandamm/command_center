import { ValidationError } from "../settings";
import { DEFAULT_PANEL_LAYOUT } from "./defaults";
import type { DashboardLayout, PanelLayoutEntry } from "./types";
import { GRID_COLS, LAYOUT_VERSION } from "./types";

const DEFAULT_BY_ID = new Map(DEFAULT_PANEL_LAYOUT.map((p) => [p.id, p]));

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

/** Merge saved layout with the current panel registry (add missing, drop stale). */
export function normalizeDashboardLayout(raw: unknown, panelIds: readonly string[]): DashboardLayout {
  if (!raw || typeof raw !== "object") throw new ValidationError("layout must be an object");
  const body = raw as DashboardLayout;
  if (body.version !== LAYOUT_VERSION) throw new ValidationError("unsupported layout version");
  if (!Array.isArray(body.panels)) throw new ValidationError("layout.panels must be an array");

  const known = new Set(panelIds);
  const byId = new Map<string, PanelLayoutEntry>();

  for (const entry of body.panels) {
    if (!entry || typeof entry !== "object" || typeof (entry as PanelLayoutEntry).id !== "string") {
      throw new ValidationError("layout.panels entries must include id");
    }
    const id = (entry as PanelLayoutEntry).id;
    if (!known.has(id)) continue;
    byId.set(id, normalizeEntry(entry as PanelLayoutEntry, known));
  }

  for (const id of panelIds) {
    if (byId.has(id)) continue;
    const fallback = DEFAULT_BY_ID.get(id);
    if (fallback) byId.set(id, { ...fallback });
    else byId.set(id, { id, x: 0, y: 0, w: 4, h: 3 });
  }

  const panels = panelIds.map((id) => byId.get(id)!);
  return {
    version: LAYOUT_VERSION,
    cols: GRID_COLS,
    rowHeight: typeof body.rowHeight === "number" && body.rowHeight > 0 ? body.rowHeight : 36,
    panels,
  };
}
