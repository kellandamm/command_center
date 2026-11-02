import type { WidgetSize } from "./schema";

export type WidgetCategory =
  | "Agenda"
  | "Productivity"
  | "Work"
  | "Agents"
  | "Monitoring"
  | "Info"
  | "Time"
  | "Finance";

export type StatusDot = "blue" | "orange" | "muted";

export interface WidgetDefinition {
  id: string;
  title: string;
  category: WidgetCategory;
  statusDot: StatusDot;
  defaultSize: WidgetSize;
  /** Existing panel module id when kind is panel. */
  panelId?: string;
  kind: "panel" | "builtin";
  /** Shown in + Add widget drawer when removable. */
  catalog: boolean;
  drawerExclude?: boolean;
  /** Only shown to verified owners (e.g. service status). */
  ownerOnly?: boolean;
}

/** Bump when new widgets are added to the registry; load appends only ids introduced after saved epoch. */
export const CURRENT_REGISTRY_EPOCH = 1;

const INTRODUCED_AT_EPOCH: Record<number, readonly string[]> = {
  1: ["today-agenda", "agent-jobs", "service-status", "countdown", "world-clock"],
};

export function widgetIdsIntroducedAfterEpoch(afterEpoch: number, opts: { showBudget: boolean }): string[] {
  const ids: string[] = [];
  for (let e = afterEpoch + 1; e <= CURRENT_REGISTRY_EPOCH; e++) {
    for (const id of INTRODUCED_AT_EPOCH[e] ?? []) {
      if (id === "budget" && !opts.showBudget) continue;
      ids.push(id);
    }
  }
  return ids;
}

const defs: WidgetDefinition[] = [
  { id: "today-agenda", title: "Today", category: "Agenda", statusDot: "blue", defaultSize: "XL", kind: "builtin", catalog: true },
  { id: "daily-briefing", title: "Daily briefing", category: "Agenda", statusDot: "blue", defaultSize: "W", panelId: "daily-briefing", kind: "panel", catalog: true },
  { id: "calendar", title: "Calendar", category: "Agenda", statusDot: "blue", defaultSize: "W", panelId: "calendar", kind: "panel", catalog: true },
  { id: "weather", title: "Weather", category: "Agenda", statusDot: "blue", defaultSize: "S", panelId: "weather", kind: "panel", catalog: true },
  { id: "tasks", title: "Tasks", category: "Productivity", statusDot: "blue", defaultSize: "W", panelId: "tasks", kind: "panel", catalog: true },
  { id: "notes", title: "Notes", category: "Productivity", statusDot: "blue", defaultSize: "W", panelId: "notes", kind: "panel", catalog: true },
  { id: "focus", title: "Focus", category: "Productivity", statusDot: "blue", defaultSize: "S", panelId: "focus", kind: "panel", catalog: false, drawerExclude: true },
  { id: "attention", title: "Attention", category: "Work", statusDot: "muted", defaultSize: "L", panelId: "attention", kind: "panel", catalog: true },
  { id: "heatmap", title: "Heatmap", category: "Work", statusDot: "blue", defaultSize: "S", panelId: "heatmap", kind: "panel", catalog: true },
  { id: "launchpad", title: "Bookmarks", category: "Work", statusDot: "blue", defaultSize: "W", panelId: "launchpad", kind: "panel", catalog: true },
  { id: "activity", title: "GitHub activity", category: "Agents", statusDot: "blue", defaultSize: "W", panelId: "activity", kind: "panel", catalog: true },
  { id: "hobie", title: "Hobie queue", category: "Agents", statusDot: "muted", defaultSize: "W", panelId: "hobie", kind: "panel", catalog: true },
  { id: "agents-usage", title: "Agents usage", category: "Agents", statusDot: "blue", defaultSize: "W", panelId: "agents-usage", kind: "panel", catalog: true },
  { id: "agent-jobs", title: "Agent jobs", category: "Agents", statusDot: "muted", defaultSize: "L", kind: "builtin", catalog: true },
  { id: "host-health", title: "Server health", category: "Monitoring", statusDot: "blue", defaultSize: "W", panelId: "host-health", kind: "panel", catalog: true },
  {
    id: "service-status",
    title: "Service status",
    category: "Monitoring",
    statusDot: "muted",
    defaultSize: "W",
    kind: "builtin",
    catalog: true,
    ownerOnly: true,
  },
  { id: "recallio", title: "Recallio", category: "Info", statusDot: "blue", defaultSize: "W", panelId: "recallio", kind: "panel", catalog: true },
  { id: "countdown", title: "Countdown", category: "Time", statusDot: "blue", defaultSize: "S", kind: "builtin", catalog: true },
  { id: "world-clock", title: "World clock", category: "Time", statusDot: "blue", defaultSize: "S", kind: "builtin", catalog: true },
  { id: "budget", title: "Budget", category: "Finance", statusDot: "blue", defaultSize: "W", panelId: "budget", kind: "panel", catalog: false, drawerExclude: true },
];

const byId = new Map(defs.map((d) => [d.id, d]));

export function widgetById(id: string): WidgetDefinition | undefined {
  return byId.get(id);
}

export function allWidgetDefinitions(): WidgetDefinition[] {
  return defs.slice();
}

export type WidgetSessionOpts = { showBudget: boolean; showServiceStatus: boolean };

export function widgetIdsForSession(opts: WidgetSessionOpts): string[] {
  return defs
    .filter((d) => {
      if (d.id === "budget" && !opts.showBudget) return false;
      if (d.ownerOnly && !opts.showServiceStatus) return false;
      return true;
    })
    .map((d) => d.id);
}

export function catalogWidgets(opts: WidgetSessionOpts): WidgetDefinition[] {
  return defs.filter((d) => {
    if (DRAWER_BLOCKLIST.has(d.id)) return false;
    if (d.drawerExclude) return false;
    if (!d.catalog) return false;
    if (d.id === "budget" && !opts.showBudget) return false;
    if (d.ownerOnly && !opts.showServiceStatus) return false;
    return true;
  });
}

/** Drawer ids that must never appear (Pomodoro / habit tracker / focus timer). */
export const DRAWER_BLOCKLIST = new Set(["pomodoro", "habit-tracker", "focus-timer", "focus"]);
