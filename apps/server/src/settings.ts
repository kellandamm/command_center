import { join } from "node:path";
import { normalizeSidebarTabs, type SidebarTab } from "./nav-tabs";
import { readJson, writeFileAtomic } from "./store";

export interface FeedScopeSettings {
  mode: "all" | "folders";
  folderIds: string[];
}

export interface ViewPreferences {
  density: "comfortable" | "compact";
  dashboard: { hobie: boolean; news: boolean; calendar: boolean; briefing: boolean; activity: boolean };
  news: { layout: "dense" | "card"; unreadOnly: boolean };
  briefing: { news: boolean; ai: boolean; todoist: boolean; weather: boolean; calendar: boolean; github: boolean };
  aiSecurity: { showArchive: boolean };
  summaries: { limit: 20 | 50 | 80 | 150 };
  hobie: { status: "all" | "pending" | "claimed" | "done" };
  calendar: { weekStartsOn: "monday" | "sunday" };
  activity: { limit: 25 | 50 | 100 | 200 };
  notes: { fontSize: "small" | "medium" | "large" };
}

export interface Settings {
  fetchIntervalMinutes: number;
  briefingTime: string;
  /** Which OPML folders feed dashboard news, briefing, and scheduled fetch. */
  feedScope: FeedScopeSettings;
  sidebarTabs: SidebarTab[];
  viewPreferences: ViewPreferences;
}

export const DEFAULT_FEED_SCOPE: FeedScopeSettings = { mode: "all", folderIds: [] };

export const DEFAULT_VIEW_PREFERENCES: ViewPreferences = {
  density: "comfortable",
  dashboard: { hobie: true, news: true, calendar: true, briefing: true, activity: true },
  news: { layout: "dense", unreadOnly: false },
  briefing: { news: true, ai: true, todoist: true, weather: true, calendar: true, github: true },
  aiSecurity: { showArchive: true },
  summaries: { limit: 80 },
  hobie: { status: "all" },
  calendar: { weekStartsOn: "monday" },
  activity: { limit: 200 },
  notes: { fontSize: "medium" },
};

export const DEFAULT_SETTINGS: Settings = {
  fetchIntervalMinutes: 30,
  briefingTime: "06:00",
  feedScope: { ...DEFAULT_FEED_SCOPE },
  sidebarTabs: normalizeSidebarTabs(undefined),
  viewPreferences: structuredClone(DEFAULT_VIEW_PREFERENCES),
};

export class ValidationError extends Error {}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeFeedScope(input: unknown, base: FeedScopeSettings): FeedScopeSettings {
  if (!input || typeof input !== "object") return base;
  const i = input as FeedScopeSettings;
  const mode = i.mode === "folders" ? "folders" : "all";
  const folderIds = Array.isArray(i.folderIds)
    ? i.folderIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 200)
    : base.folderIds;
  return { mode, folderIds };
}

function enumSetting<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T, field: string): T {
  if (value === undefined) return fallback;
  if (allowed.includes(value as T)) return value as T;
  throw new ValidationError(`${field} is invalid`);
}

function booleanSetting(value: unknown, fallback: boolean, field: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new ValidationError(`${field} must be a boolean`);
  return value;
}

function objectSetting(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeViewPreferences(input: unknown, base: ViewPreferences): ViewPreferences {
  const i = objectSetting(input);
  const dashboard = objectSetting(i.dashboard);
  const news = objectSetting(i.news);
  const briefing = objectSetting(i.briefing);
  const aiSecurity = objectSetting(i.aiSecurity);
  const summaries = objectSetting(i.summaries);
  const hobie = objectSetting(i.hobie);
  const calendar = objectSetting(i.calendar);
  const activity = objectSetting(i.activity);
  const notes = objectSetting(i.notes);
  return {
    density: enumSetting(i.density, ["comfortable", "compact"], base.density, "viewPreferences.density"),
    dashboard: {
      hobie: booleanSetting(dashboard.hobie, base.dashboard.hobie, "viewPreferences.dashboard.hobie"),
      news: booleanSetting(dashboard.news, base.dashboard.news, "viewPreferences.dashboard.news"),
      calendar: booleanSetting(dashboard.calendar, base.dashboard.calendar, "viewPreferences.dashboard.calendar"),
      briefing: booleanSetting(dashboard.briefing, base.dashboard.briefing, "viewPreferences.dashboard.briefing"),
      activity: booleanSetting(dashboard.activity, base.dashboard.activity, "viewPreferences.dashboard.activity"),
    },
    news: {
      layout: enumSetting(news.layout, ["dense", "card"], base.news.layout, "viewPreferences.news.layout"),
      unreadOnly: booleanSetting(news.unreadOnly, base.news.unreadOnly, "viewPreferences.news.unreadOnly"),
    },
    briefing: {
      news: booleanSetting(briefing.news, base.briefing.news, "viewPreferences.briefing.news"),
      ai: booleanSetting(briefing.ai, base.briefing.ai, "viewPreferences.briefing.ai"),
      todoist: booleanSetting(briefing.todoist, base.briefing.todoist, "viewPreferences.briefing.todoist"),
      weather: booleanSetting(briefing.weather, base.briefing.weather, "viewPreferences.briefing.weather"),
      calendar: booleanSetting(briefing.calendar, base.briefing.calendar, "viewPreferences.briefing.calendar"),
      github: booleanSetting(briefing.github, base.briefing.github, "viewPreferences.briefing.github"),
    },
    aiSecurity: {
      showArchive: booleanSetting(aiSecurity.showArchive, base.aiSecurity.showArchive, "viewPreferences.aiSecurity.showArchive"),
    },
    summaries: {
      limit: enumSetting(summaries.limit, [20, 50, 80, 150], base.summaries.limit, "viewPreferences.summaries.limit"),
    },
    hobie: {
      status: enumSetting(hobie.status, ["all", "pending", "claimed", "done"], base.hobie.status, "viewPreferences.hobie.status"),
    },
    calendar: {
      weekStartsOn: enumSetting(calendar.weekStartsOn, ["monday", "sunday"], base.calendar.weekStartsOn, "viewPreferences.calendar.weekStartsOn"),
    },
    activity: {
      limit: enumSetting(activity.limit, [25, 50, 100, 200], base.activity.limit, "viewPreferences.activity.limit"),
    },
    notes: {
      fontSize: enumSetting(notes.fontSize, ["small", "medium", "large"], base.notes.fontSize, "viewPreferences.notes.fontSize"),
    },
  };
}

export function applySettings(base: Settings, input: unknown): Settings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new ValidationError("settings must be an object");
  const i = input as Record<string, unknown>;
  const out: Settings = structuredClone(base);

  if (i.fetchIntervalMinutes !== undefined) {
    const n = Number(i.fetchIntervalMinutes);
    if (!Number.isInteger(n) || n < 5 || n > 24 * 60) throw new ValidationError("fetchIntervalMinutes must be 5–1440");
    out.fetchIntervalMinutes = n;
  }
  if (i.briefingTime !== undefined) {
    if (typeof i.briefingTime !== "string" || !TIME.test(i.briefingTime)) throw new ValidationError("briefingTime must be like 07:00");
    out.briefingTime = i.briefingTime;
  }
  if (i.feedScope !== undefined) {
    out.feedScope = normalizeFeedScope(i.feedScope, out.feedScope);
  }
  if (i.sidebarTabs !== undefined) {
    out.sidebarTabs = normalizeSidebarTabs(Array.isArray(i.sidebarTabs) ? i.sidebarTabs : out.sidebarTabs);
  }
  if (i.viewPreferences !== undefined) {
    out.viewPreferences = normalizeViewPreferences(i.viewPreferences, out.viewPreferences);
  }
  return out;
}

export class SettingsStore {
  private current: Settings = structuredClone(DEFAULT_SETTINGS);
  private path: string;
  private legacyFeedsText: string | undefined;

  constructor(dir: string) {
    this.path = join(dir, "settings.json");
  }

  async load(): Promise<Settings> {
    const saved = await readJson<Record<string, unknown>>(this.path);
    if (saved?.feeds && typeof saved.feeds === "string") {
      this.legacyFeedsText = saved.feeds;
      delete saved.feeds;
    }
    const merged = saved ? applySettings(DEFAULT_SETTINGS, saved) : structuredClone(DEFAULT_SETTINGS);
    merged.sidebarTabs = normalizeSidebarTabs(merged.sidebarTabs);
    merged.feedScope = normalizeFeedScope(merged.feedScope, DEFAULT_FEED_SCOPE);
    merged.viewPreferences = normalizeViewPreferences(merged.viewPreferences, DEFAULT_VIEW_PREFERENCES);
    this.current = merged;
    return this.current;
  }

  /** One-time RSS textarea from legacy settings.json (migrated into sqlite on startup). */
  consumeLegacyFeeds(): string | undefined {
    const t = this.legacyFeedsText;
    this.legacyFeedsText = undefined;
    return t;
  }

  get(): Settings {
    return this.current;
  }

  async update(input: unknown): Promise<Settings> {
    this.current = applySettings(this.current, input);
    await writeFileAtomic(this.path, JSON.stringify(this.current, null, 2));
    return this.current;
  }
}
