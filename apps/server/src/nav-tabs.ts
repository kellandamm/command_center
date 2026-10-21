import type { Settings } from "./settings";

export type SidebarTabId =
  | "dashboard"
  | "ai-security"
  | "briefing"
  | "read-later"
  | "library"
  | "spaces"
  | "assistant"
  | "board"
  | "wins"
  | "notes"
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
  { id: "ai-security", href: "/ai-security", label: "AI Security", visible: true, order: 10 },
  { id: "briefing", href: "/briefing", label: "Daily Briefing", visible: true, order: 20 },
  { id: "read-later", href: "/read-later", label: "Read later", visible: true, order: 30 },
  { id: "library", href: "/library", label: "Library", visible: true, order: 40 },
  { id: "board", href: "/board", label: "Board", visible: true, order: 50 },
  { id: "wins", href: "/wins", label: "Wins", visible: true, order: 55 },
  { id: "notes", href: "/notes", label: "Notes", visible: true, order: 60 },
  { id: "spaces", href: "/spaces", label: "Spaces", visible: true, order: 62 },
  { id: "assistant", href: "/assistant", label: "Assistant", visible: true, order: 65 },
  { id: "calendar", href: "/calendar", label: "Calendar", visible: true, order: 70 },
  { id: "activity", href: "/activity", label: "Activity", visible: true, order: 80 },
  { id: "settings", href: "/settings", label: "Settings", visible: true, order: 90, locked: true },
];

const DEFAULT_BY_ID = new Map(DEFAULT_SIDEBAR_TABS.map((t) => [t.id, t]));
const migratedId = (id: string) => ({ hobie: "board", news: "read-later", summaries: "library" }[id] ?? id) as SidebarTabId;

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
      const id = migratedId(idRaw);
      if (!DEFAULT_BY_ID.has(id)) continue;
      const base = byId.get(id)!;
      let label = typeof (row as SidebarTab).label === "string" ? (row as SidebarTab).label.trim() : base.label;
      if ((idRaw === "news" && label === "News") || (idRaw === "summaries" && label === "Summaries")) label = base.label;
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
    const id = migratedId(idRaw);
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
