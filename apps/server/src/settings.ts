import { join } from "node:path";
import { MODEL_CHOICES, normalizeBlockList, DEFAULT_BLOCKED_SITES, type HomepageModel } from "@homepage/agent-core";
import { readJson, writeFileAtomic } from "./store";

export interface Caps {
  /** USD. A build is stopped as soon as it passes this. */
  perBuild: number;
  daily: number;
  monthly: number;
  maxBuildsPerDay: number;
}

export interface Settings {
  /** One source per line; see sources.ts for the syntax. */
  sources: string;
  /** Extra standing instructions for the agent ("I care about Rust and cycling"). */
  instructions: string;
  model: HomepageModel;
  scheduleEnabled: boolean;
  /** HH:MM in the server's TZ. */
  times: string[];
  caps: Caps;
  keepEditions: number;
  blockedSites: string[];
}

export const DEFAULT_SOURCES = [
  "# One source per line. Prefix with rss: / hn / github: or give a plain page URL.",
  "# Add *3 at the end to weight a source higher (1-5).",
  "hn",
  "rss:https://www.theverge.com/rss/index.xml",
  "github:anthropics/claude-code",
  "https://lobste.rs",
].join("\n");

export const DEFAULT_SETTINGS: Settings = {
  sources: DEFAULT_SOURCES,
  instructions: "",
  model: MODEL_CHOICES[0].id,
  scheduleEnabled: true,
  times: ["06:30"],
  caps: { perBuild: 1.5, daily: 3, monthly: 30, maxBuildsPerDay: 6 },
  keepEditions: 60,
  blockedSites: [...DEFAULT_BLOCKED_SITES],
};

export class ValidationError extends Error {}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Merge a partial update over `base`, rejecting anything out of range. Never trusts the shape of `input`. */
export function applySettings(base: Settings, input: unknown): Settings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new ValidationError("settings must be an object");
  const i = input as Record<string, unknown>;
  const out: Settings = structuredClone(base);

  if (i.sources !== undefined) {
    if (typeof i.sources !== "string" || i.sources.length > 20_000) throw new ValidationError("sources must be text under 20k characters");
    out.sources = i.sources;
  }
  if (i.instructions !== undefined) {
    if (typeof i.instructions !== "string" || i.instructions.length > 4000) throw new ValidationError("instructions must be text under 4000 characters");
    out.instructions = i.instructions;
  }
  if (i.model !== undefined) {
    if (!MODEL_CHOICES.some((m) => m.id === i.model)) throw new ValidationError("unknown model");
    out.model = i.model as HomepageModel;
  }
  if (i.scheduleEnabled !== undefined) {
    if (typeof i.scheduleEnabled !== "boolean") throw new ValidationError("scheduleEnabled must be true or false");
    out.scheduleEnabled = i.scheduleEnabled;
  }
  if (i.times !== undefined) {
    if (!Array.isArray(i.times) || i.times.length > 6 || !i.times.every((t) => typeof t === "string" && TIME.test(t))) {
      throw new ValidationError("times must be up to 6 values like 06:30");
    }
    out.times = [...new Set(i.times as string[])].sort();
  }
  if (i.caps !== undefined) {
    const c = i.caps as Record<string, unknown>;
    if (typeof c !== "object" || c === null) throw new ValidationError("caps must be an object");
    for (const key of ["perBuild", "daily", "monthly"] as const) {
      if (c[key] === undefined) continue;
      const n = Number(c[key]);
      if (!Number.isFinite(n) || n <= 0 || n > 10_000) throw new ValidationError(`caps.${key} must be a positive number of dollars`);
      out.caps[key] = n;
    }
    if (c.maxBuildsPerDay !== undefined) {
      const n = Number(c.maxBuildsPerDay);
      if (!Number.isInteger(n) || n < 1 || n > 100) throw new ValidationError("caps.maxBuildsPerDay must be 1-100");
      out.caps.maxBuildsPerDay = n;
    }
  }
  if (i.keepEditions !== undefined) {
    const n = Number(i.keepEditions);
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw new ValidationError("keepEditions must be 1-1000");
    out.keepEditions = n;
  }
  if (i.blockedSites !== undefined) {
    const list = Array.isArray(i.blockedSites) ? i.blockedSites : typeof i.blockedSites === "string" ? i.blockedSites.split("\n") : null;
    if (!list || list.length > 500 || !list.every((l) => typeof l === "string")) throw new ValidationError("blockedSites must be a list of hosts");
    out.blockedSites = normalizeBlockList(list as string[]);
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
