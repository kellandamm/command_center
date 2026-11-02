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

export type StatusDot = "green" | "blue" | "orange" | "red";

export interface WidgetDefinition {
  id: string;
  title: string;
  category: WidgetCategory;
  statusDot: StatusDot;
  defaultSize: WidgetSize;
  /** Existing panel module id when kind is panel. */
  panelId?: string;
  kind: "panel" | "builtin";
  /** Shown in + Add widget drawer. */
  catalog: boolean;
  drawerExclude?: boolean;
}

const defs: WidgetDefinition[] = [
  { id: "today-agenda", title: "Today", category: "Agenda", statusDot: "blue", defaultSize: "XL", kind: "builtin", catalog: true },
  { id: "daily-briefing", title: "Daily briefing", category: "Agenda", statusDot: "green", defaultSize: "W", panelId: "daily-briefing", kind: "panel", catalog: true },
  { id: "calendar", title: "Calendar", category: "Agenda", statusDot: "green", defaultSize: "W", panelId: "calendar", kind: "panel", catalog: true },
  { id: "weather", title: "Weather", category: "Agenda", statusDot: "green", defaultSize: "S", panelId: "weather", kind: "panel", catalog: true },
  { id: "tasks", title: "Tasks", category: "Productivity", statusDot: "green", defaultSize: "W", panelId: "tasks", kind: "panel", catalog: true },
  { id: "notes", title: "Notes", category: "Productivity", statusDot: "green", defaultSize: "W", panelId: "notes", kind: "panel", catalog: true },
  { id: "focus", title: "Focus", category: "Productivity", statusDot: "green", defaultSize: "S", panelId: "focus", kind: "panel", catalog: false, drawerExclude: true },
  { id: "attention", title: "Attention", category: "Work", statusDot: "orange", defaultSize: "L", panelId: "attention", kind: "panel", catalog: false },
  { id: "heatmap", title: "Heatmap", category: "Work", statusDot: "green", defaultSize: "S", panelId: "heatmap", kind: "panel", catalog: false },
  { id: "launchpad", title: "Bookmarks", category: "Work", statusDot: "green", defaultSize: "W", panelId: "launchpad", kind: "panel", catalog: true },
  { id: "activity", title: "GitHub activity", category: "Agents", statusDot: "blue", defaultSize: "W", panelId: "activity", kind: "panel", catalog: true },
  { id: "hobie", title: "Hobie queue", category: "Agents", statusDot: "orange", defaultSize: "W", panelId: "hobie", kind: "panel", catalog: false },
  { id: "agents-usage", title: "Agents usage", category: "Agents", statusDot: "blue", defaultSize: "W", panelId: "agents-usage", kind: "panel", catalog: false },
  { id: "agent-jobs", title: "Agent jobs", category: "Agents", statusDot: "orange", defaultSize: "L", kind: "builtin", catalog: true },
  { id: "host-health", title: "Server health", category: "Monitoring", statusDot: "green", defaultSize: "W", panelId: "host-health", kind: "panel", catalog: false },
  { id: "service-status", title: "Service status", category: "Monitoring", statusDot: "red", defaultSize: "W", kind: "builtin", catalog: true },
  { id: "recallio", title: "Recallio", category: "Info", statusDot: "green", defaultSize: "W", panelId: "recallio", kind: "panel", catalog: false },
  { id: "countdown", title: "Countdown", category: "Time", statusDot: "green", defaultSize: "S", kind: "builtin", catalog: true },
  { id: "world-clock", title: "World clock", category: "Time", statusDot: "green", defaultSize: "S", kind: "builtin", catalog: true },
  { id: "budget", title: "Budget", category: "Finance", statusDot: "green", defaultSize: "W", panelId: "budget", kind: "panel", catalog: false, drawerExclude: true },
];

const byId = new Map(defs.map((d) => [d.id, d]));

export function widgetById(id: string): WidgetDefinition | undefined {
  return byId.get(id);
}

export function allWidgetDefinitions(): WidgetDefinition[] {
  return defs.slice();
}

export function widgetIdsForSession(opts: { showBudget: boolean }): string[] {
  return defs.filter((d) => opts.showBudget || d.id !== "budget").map((d) => d.id);
}

export function catalogWidgets(opts: { showBudget: boolean }): WidgetDefinition[] {
  return defs.filter((d) => {
    if (d.drawerExclude) return false;
    if (!d.catalog) return false;
    if (d.id === "budget" && !opts.showBudget) return false;
    return true;
  });
}

/** Drawer ids that must never appear (Pomodoro / habit tracker aliases). */
export const DRAWER_BLOCKLIST = new Set(["pomodoro", "habit-tracker", "focus-timer"]);
