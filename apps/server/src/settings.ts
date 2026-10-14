import { join } from "node:path";
import { readJson, writeFileAtomic } from "./store";

export interface Settings {
  /** One RSS/Atom feed URL (or `hn`) per line; `#` comments allowed. */
  feeds: string;
  /** Fetch feeds on this interval while the server runs. */
  fetchIntervalMinutes: number;
  /** Daily briefing wall-clock time in the server TZ (HH:MM). */
  briefingTime: string;
}

export const DEFAULT_FEEDS = [
  "# One feed per line. Use hn for Hacker News (Firebase API).",
  "hn",
  "https://www.theverge.com/rss/index.xml",
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://www.reuters.com/tools/rss",
].join("\n");

export const DEFAULT_SETTINGS: Settings = {
  feeds: DEFAULT_FEEDS,
  fetchIntervalMinutes: 30,
  briefingTime: "06:00",
};

export class ValidationError extends Error {}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function applySettings(base: Settings, input: unknown): Settings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new ValidationError("settings must be an object");
  const i = input as Record<string, unknown>;
  const out: Settings = structuredClone(base);

  if (i.feeds !== undefined) {
    if (typeof i.feeds !== "string" || i.feeds.length > 20_000) throw new ValidationError("feeds must be text under 20k characters");
    out.feeds = i.feeds;
  }
  if (i.fetchIntervalMinutes !== undefined) {
    const n = Number(i.fetchIntervalMinutes);
    if (!Number.isInteger(n) || n < 5 || n > 24 * 60) throw new ValidationError("fetchIntervalMinutes must be 5–1440");
    out.fetchIntervalMinutes = n;
  }
  if (i.briefingTime !== undefined) {
    if (typeof i.briefingTime !== "string" || !TIME.test(i.briefingTime)) throw new ValidationError("briefingTime must be like 07:00");
    out.briefingTime = i.briefingTime;
  }
  return out;
}

export class SettingsStore {
  private current: Settings = structuredClone(DEFAULT_SETTINGS);
  private path: string;
  constructor(dir: string) {
    this.path = join(dir, "settings.json");
  }
  async load(): Promise<Settings> {
    const saved = await readJson<unknown>(this.path);
    this.current = saved ? applySettings(DEFAULT_SETTINGS, saved) : structuredClone(DEFAULT_SETTINGS);
    return this.current;
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
