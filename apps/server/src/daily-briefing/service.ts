import { join } from "node:path";
import type { Config, LlmConfig } from "../config";
import { llmConfig, todoistConfigured } from "../config";
import { fetchCalendarEvents } from "../calendar/service";
import type { FeedsStore } from "../feeds/store";
import { fetchGithubActivity } from "../github/activity";
import { chatCompletion } from "../llm/provider";
import { dayKey } from "../store";
import { listTasks, partitionTodayAndOverdue } from "../todoist/client";
import { fetchOpenMeteo } from "../weather/open-meteo";
import {
  briefingDayPath,
  ensureBriefingDir,
  listBriefingDays,
  readBriefingFile,
  writeBriefingFile,
} from "./storage";
import type { DailyBriefingRecord, DailyBriefingSources, SourceBlock, SourceStatus } from "./types";
import type { StoredItem } from "../feeds/store";

function block<T>(status: SourceStatus, data?: T, message?: string): SourceBlock<T> {
  const out: SourceBlock<T> = { status };
  if (message) out.message = message;
  if (data !== undefined) out.data = data;
  return out;
}

function formatItems(items: StoredItem[]): string {
  return items
    .map((it, i) => {
      const parts = [`${i + 1}. ${it.title}`];
      if (it.link) parts.push(`   ${it.link}`);
      if (it.summary) parts.push(`   ${it.summary.slice(0, 280)}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

export class DailyBriefingService {
  private dir: string;
  constructor(
    dataDir: string,
    private tz: string,
  ) {
    this.dir = join(dataDir, "daily-briefings");
  }

  static async open(dataDir: string, tz: string): Promise<DailyBriefingService> {
    const svc = new DailyBriefingService(dataDir, tz);
    await ensureBriefingDir(svc.dir);
    return svc;
  }

  async listDays(): Promise<string[]> {
    return listBriefingDays(this.dir);
  }

  async get(day: string): Promise<DailyBriefingRecord | undefined> {
    return readBriefingFile(briefingDayPath(this.dir, day));
  }

  async getToday(now = new Date()): Promise<DailyBriefingRecord | undefined> {
    return this.get(dayKey(now, this.tz));
  }

  async generate(opts: {
    cfg: Config;
    feeds: FeedsStore;
    trigger: "schedule" | "manual";
    now?: Date;
    fetchFn?: typeof fetch;
  }): Promise<DailyBriefingRecord> {
    const now = opts.now ?? new Date();
    const day = dayKey(now, this.tz);
    const sinceIso = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
    const fetchFn = opts.fetchFn ?? fetch;
    const sources = await this.gatherSources(opts.cfg, opts.feeds, sinceIso, now, fetchFn);
    const rec: DailyBriefingRecord = { day, generatedAt: now.toISOString(), trigger: opts.trigger, sources };
    await writeBriefingFile(briefingDayPath(this.dir, day), rec);
    return rec;
  }

  private async gatherSources(
    cfg: Config,
    feeds: FeedsStore,
    sinceIso: string,
    now: Date,
    fetchFn: typeof fetch,
  ): Promise<DailyBriefingSources> {
    const newsItems = feeds.itemsForBriefing(sinceIso);
    const news: DailyBriefingSources["news"] =
      newsItems.length > 0
        ? block("ok", { items: newsItems, itemCount: newsItems.length })
        : block("empty", { items: [], itemCount: 0 }, "No new feed items in the last 24 hours.");

    const llm = llmConfig(cfg);
    const ai = await this.buildAi(llm, newsItems, dayKey(now, this.tz), fetchFn);

    const todoist = await this.buildTodoist(cfg, now, fetchFn);
    const weather = await this.buildWeather(cfg, fetchFn);
    const calendar = await this.buildCalendar(cfg);
    const github = await this.buildGithub(cfg);

    return { news, ai, todoist, weather, calendar, github };
  }

  private async buildAi(
    llm: LlmConfig | null,
    items: StoredItem[],
    day: string,
    fetchFn: typeof fetch,
  ): Promise<DailyBriefingSources["ai"]> {
    if (!llm) {
      return block("not_configured", { content: "", itemCount: items.length }, "LLM not configured (set LLM_BASE_URL, LLM_API_KEY, LLM_MODEL).");
    }
    if (!items.length) {
      return block("empty", { content: "", itemCount: 0 }, "No feed items to summarize.");
    }
    try {
      const content = await chatCompletion(
        llm,
        [
          {
            role: "system",
            content:
              "You write a concise morning briefing for one person. Use short sections and bullet points. " +
              "Highlight what matters, group related stories, and keep a calm practical tone. Plain text only.",
          },
          {
            role: "user",
            content: `Summarize these ${items.length} new feed items for today (${day}):\n\n${formatItems(items)}`,
          },
        ],
        fetchFn,
      );
      return block("ok", { content, itemCount: items.length });
    } catch (err) {
      return block(
        "error",
        { content: "", itemCount: items.length },
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async buildTodoist(cfg: Config, now: Date, fetchFn: typeof fetch): Promise<DailyBriefingSources["todoist"]> {
    if (!todoistConfigured(cfg)) {
      return block("not_configured", { overdue: [], today: [] }, "Todoist is not configured — set TODOIST_API_TOKEN on the server.");
    }
    try {
      const tasks = await listTasks(cfg.todoistApiToken!, fetchFn);
      const { overdue, today } = partitionTodayAndOverdue(tasks, now, cfg.tz);
      if (!overdue.length && !today.length) {
        return block("empty", { overdue, today }, "No tasks due today or overdue.");
      }
      return block("ok", { overdue, today });
    } catch (err) {
      return block(
        "error",
        { overdue: [], today: [] },
        err instanceof Error ? err.message : "Todoist request failed",
      );
    }
  }

  private async buildWeather(cfg: Config, fetchFn: typeof fetch): Promise<DailyBriefingSources["weather"]> {
    try {
      const weather = await fetchOpenMeteo(cfg.weatherLat, cfg.weatherLon, cfg.tz, fetchFn);
      return block("ok", { weather, lat: cfg.weatherLat, lon: cfg.weatherLon });
    } catch (err) {
      return block(
        "error",
        undefined,
        err instanceof Error ? err.message : "Weather fetch failed",
      );
    }
  }

  private async buildCalendar(cfg: Config): Promise<DailyBriefingSources["calendar"]> {
    if (!cfg.icsUrls.length) {
      return block("not_configured", { events: [] }, "Calendar is not configured — set ICS_URLS on the server.");
    }
    const snap = await fetchCalendarEvents(cfg.icsUrls, cfg.tz);
    if (!snap.events.length) {
      const bad = snap.feeds.filter((f) => !f.ok);
      const msg = bad.length ? `No upcoming events (${bad.length} feed error(s)).` : "No upcoming events in the next two weeks.";
      return block("empty", { events: [] }, msg);
    }
    return block("ok", { events: snap.events });
  }

  private async buildGithub(cfg: Config): Promise<DailyBriefingSources["github"]> {
    try {
      const activity = await fetchGithubActivity({ username: cfg.githubUsername, token: cfg.githubToken });
      const hasData = activity.pulls.length || activity.issues.length || activity.events.length;
      if (!hasData) {
        return block("empty", { activity }, "No open PRs, issues, or recent public activity.");
      }
      return block("ok", { activity });
    } catch (err) {
      return block(
        "error",
        undefined,
        err instanceof Error ? err.message : "GitHub request failed",
      );
    }
  }
}
