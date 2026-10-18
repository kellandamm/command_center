import type { Settings } from "./settings";

export type SidebarTabId =
  | "dashboard"
  | "briefing"
  | "board"
  | "wins"
  | "notes"
  | "bookmarks"
  | "calendar"
  | "activity"
  | "settings";

export interface SidebarTab {
  id: SidebarTabId;
  href: string;
  label: string;
  visible: boolean;
  order: number;
  /** Dashboard and Settings cannot be hidden. */
  locked?: boolean;
}

const LOCKED = new Set<SidebarTabId>(["dashboard", "settings"]);

export const DEFAULT_SIDEBAR_TABS: SidebarTab[] = [
  { id: "dashboard", href: "/", label: "Dashboard", visible: true, order: 0, locked: true },
  { id: "briefing", href: "/briefing", label: "Daily Briefing", visible: true, order: 20 },
  { id: "board", href: "/board", label: "Board", visible: true, order: 50 },
  { id: "wins", href: "/wins", label: "Wins", visible: true, order: 55 },
  { id: "notes", href: "/notes", label: "Notes", visible: true, order: 60 },
  { id: "bookmarks", href: "/bookmarks", label: "Bookmarks", visible: true, order: 65 },
  { id: "calendar", href: "/calendar", label: "Calendar", visible: true, order: 70 },
  { id: "activity", href: "/activity", label: "Activity", visible: true, order: 80 },
  { id: "settings", href: "/settings", label: "Settings", visible: true, order: 90, locked: true },
];

const DEFAULT_BY_ID = new Map(DEFAULT_SIDEBAR_TABS.map((t) => [t.id, t]));

export function normalizeSidebarTabs(input: unknown): SidebarTab[] {
  const byId = new Map<SidebarTabId, SidebarTab>();
  for (const base of DEFAULT_SIDEBAR_TABS) {
    byId.set(base.id, { ...base });
  }
  if (Array.isArray(input)) {
    for (const row of input) {
      if (!row || typeof row !== "object") continue;
      const idRaw = (row as { id?: unknown }).id;
      if (typeof idRaw !== "string") continue;
      const id = (idRaw === "hobie" ? "board" : idRaw) as SidebarTabId;
      if (!DEFAULT_BY_ID.has(id)) continue;
      const base = byId.get(id)!;
      const label = typeof (row as SidebarTab).label === "string" ? (row as SidebarTab).label.trim() : base.label;
      const visible = LOCKED.has(id) ? true : Boolean((row as SidebarTab).visible);
      const order = Number.isFinite((row as SidebarTab).order) ? Number((row as SidebarTab).order) : base.order;
      byId.set(id, {
        ...base,
        label: label.slice(0, 48) || base.label,
        visible,
        order,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function visibleNavTabs(tabs: SidebarTab[]): Array<{ href: string; label: string }> {
  return tabs
    .filter((t) => t.visible || t.locked)
    .sort((a, b) => a.order - b.order)
    .map((t) => ({ href: t.href, label: t.label }));
}

export function applySidebarTabsPatch(current: SidebarTab[], patch: unknown): SidebarTab[] {
  if (!Array.isArray(patch)) return current;
  const byId = new Map(current.map((t) => [t.id, { ...t }]));
  for (const row of patch) {
    if (!row || typeof row !== "object") continue;
    const idRaw = (row as { id?: unknown }).id;
    if (typeof idRaw !== "string") continue;
    const id = (idRaw === "hobie" ? "board" : idRaw) as SidebarTabId;
    if (!DEFAULT_BY_ID.has(id)) continue;
    const cur = byId.get(id)!;
    if (typeof (row as SidebarTab).label === "string") {
      const label = (row as SidebarTab).label.trim().slice(0, 48);
      if (label) cur.label = label;
    }
    if ((row as SidebarTab).order !== undefined && Number.isFinite(Number((row as SidebarTab).order))) {
      cur.order = Number((row as SidebarTab).order);
    }
    if ((row as SidebarTab).visible !== undefined && !LOCKED.has(id)) {
      cur.visible = Boolean((row as SidebarTab).visible);
    }
  }
  return normalizeSidebarTabs([...byId.values()]);
}
