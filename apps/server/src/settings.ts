import { join } from "node:path";
import { normalizeSidebarTabs, type SidebarTab } from "./nav-tabs";
import { readJson, writeFileAtomic } from "./store";

export interface FeedScopeSettings {
  mode: "all" | "folders";
  folderIds: string[];
}

export interface Settings {
  fetchIntervalMinutes: number;
  briefingTime: string;
  /** Which OPML folders feed dashboard news, briefing, and scheduled fetch. */
  feedScope: FeedScopeSettings;
  sidebarTabs: SidebarTab[];
}

export const DEFAULT_FEED_SCOPE: FeedScopeSettings = { mode: "all", folderIds: [] };

export const DEFAULT_SETTINGS: Settings = {
  fetchIntervalMinutes: 30,
  briefingTime: "06:00",
  feedScope: { ...DEFAULT_FEED_SCOPE },
  sidebarTabs: normalizeSidebarTabs(undefined),
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
