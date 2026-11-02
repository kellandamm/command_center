import type { DashboardLayout, PanelLayoutEntry } from "./types";
import type { DashboardLayoutV3, WidgetLayoutEntry } from "./schema";
import { LAYOUT_VERSION, dashboardLayoutV3Schema, legacyLayoutSchema, widgetEntrySchema } from "./schema";
import { inferSizeFromLegacy } from "./sizes";
import { packWidgetFlow } from "./pack";
import { CURRENT_REGISTRY_EPOCH, widgetById, widgetIdsIntroducedAfterEpoch } from "./widgets";

function defaultConfigFor(id: string): Record<string, unknown> | undefined {
  if (id === "countdown") {
    return { label: "Demo Day (example)", target: "2026-12-31" };
  }
  if (id === "world-clock") {
    return { zones: ["America/Chicago", "Europe/London", "Asia/Tokyo"] };
  }
  return undefined;
}

function defaultWidgetEntry(id: string): WidgetLayoutEntry {
  const def = widgetById(id);
  return {
    id,
    size: def?.defaultSize ?? "W",
    ...(defaultConfigFor(id) ? { config: defaultConfigFor(id) } : {}),
  };
}

/** Default widget order for fresh layouts (revamp mockup + remaining panels). */
export function defaultDashboardWidgets(showBudget: boolean, showServiceStatus = true): WidgetLayoutEntry[] {
  const order = [
    "today-agenda",
    "agent-jobs",
    ...(showServiceStatus ? (["service-status"] as const) : []),
    "countdown",
    "world-clock",
    "tasks",
    "notes",
    "attention",
    "daily-briefing",
    "weather",
    "calendar",
    "heatmap",
    "launchpad",
    "activity",
    "hobie",
    "host-health",
    "recallio",
    "agents-usage",
    ...(showBudget ? (["budget"] as const) : []),
  ];
  return order.map((id) => defaultWidgetEntry(id));
}

export function defaultDashboardLayout(opts: { showBudget?: boolean; showServiceStatus?: boolean } = {}): DashboardLayout {
  const showBudget = opts.showBudget ?? false;
  const showServiceStatus = opts.showServiceStatus ?? true;
  const widgets = defaultDashboardWidgets(showBudget, showServiceStatus);
  const panels = packWidgetFlow(widgets);
  return { version: LAYOUT_VERSION, registryEpoch: CURRENT_REGISTRY_EPOCH, widgets, panels };
}

export function defaultEntryForPanel(id: string): PanelLayoutEntry {
  const widgets = defaultDashboardWidgets(true);
  const packed = packWidgetFlow(widgets);
  const hit = packed.find((p) => p.id === id);
  if (hit) return { ...hit };
  const entry = defaultWidgetEntry(id);
  const [panel] = packWidgetFlow([entry]);
  return panel!;
}

/** Safe parse for API/load — never throws; returns default on failure. */
export function parseDashboardLayout(
  raw: unknown,
  knownIds: readonly string[],
  showBudget: boolean,
  opts?: { appendMissing?: boolean; appendNewRegistryWidgets?: boolean },
): DashboardLayout {
  try {
    return normalizeDashboardLayout(raw, knownIds, showBudget, opts);
  } catch {
    return defaultDashboardLayout({ showBudget });
  }
}

export function normalizeDashboardLayout(
  raw: unknown,
  knownIds: readonly string[],
  showBudget: boolean,
  opts?: { appendMissing?: boolean; appendNewRegistryWidgets?: boolean },
): DashboardLayout {
  const known = new Set(knownIds);
  const fallback = () => defaultDashboardLayout({ showBudget });

  if (raw === null || raw === undefined) return fallback();

  let body: unknown = raw;
  if (typeof raw === "string") {
    try {
      body = JSON.parse(raw);
    } catch {
      return fallback();
    }
  }

  const legacy = legacyLayoutSchema.safeParse(body);
  if (!legacy.success) throw new Error("invalid layout");

  const data = legacy.data;
  let widgets: WidgetLayoutEntry[] = [];
  let savedEpoch = 0;

  if (data.version === LAYOUT_VERSION && Array.isArray(data.widgets)) {
    const parsed = dashboardLayoutV3Schema.safeParse(data);
    if (!parsed.success) throw new Error("invalid v3 layout");
    savedEpoch = parsed.data.registryEpoch ?? 0;
    widgets = parsed.data.widgets.filter((w) => known.has(w.id));
  } else if (Array.isArray(data.panels)) {
    const sorted = [...data.panels].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
    for (const p of sorted) {
      if (!p?.id || !known.has(p.id)) continue;
      const w = p.w ?? 3;
      const h = p.h ?? 2;
      widgets.push({
        id: p.id,
        size: inferSizeFromLegacy(w, h),
      });
    }
  } else if (Array.isArray(data.widgets)) {
    for (const w of data.widgets) {
      const parsed = widgetEntrySchema.safeParse(w);
      if (parsed.success && known.has(parsed.data.id)) widgets.push(parsed.data);
    }
  }

  if (!widgets.length) return fallback();

  const appendAll = opts?.appendMissing === true;
  const appendNew = opts?.appendNewRegistryWidgets !== false;
  if (appendAll) {
    for (const id of knownIds) {
      if (!widgets.some((w) => w.id === id)) widgets.push(defaultWidgetEntry(id));
    }
  } else if (appendNew) {
    for (const id of widgetIdsIntroducedAfterEpoch(savedEpoch, { showBudget })) {
      if (!known.has(id)) continue;
      if (!widgets.some((w) => w.id === id)) widgets.push(defaultWidgetEntry(id));
    }
  }

  widgets = widgets.filter((w) => known.has(w.id)).slice(0, 40);
  const panels = packWidgetFlow(widgets);
  return { version: LAYOUT_VERSION, registryEpoch: CURRENT_REGISTRY_EPOCH, widgets, panels };
}
