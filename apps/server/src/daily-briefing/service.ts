import { join } from "node:path";
import type { Config } from "../config";
import { todoistConfigured } from "../config";
import { fetchCalendarEvents } from "../calendar/service";
import { fetchGithubActivity } from "../github/activity";
import type { BoardStore } from "../board/store";
import type { WinsStore } from "../wins/store";
import { slotInstant } from "../scheduler";
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

function block<T>(status: SourceStatus, data?: T, message?: string): SourceBlock<T> {
  const out: SourceBlock<T> = { status };
  if (message) out.message = message;
  if (data !== undefined) out.data = data;
  return out;
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
    board?: BoardStore;
    wins?: WinsStore;
    trigger: "schedule" | "manual";
    now?: Date;
    fetchFn?: typeof fetch;
  }): Promise<DailyBriefingRecord> {
    const now = opts.now ?? new Date();
    const day = dayKey(now, this.tz);
    const sinceIso = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
    const fetchFn = opts.fetchFn ?? fetch;
    const sources = await this.gatherSources(opts.cfg, sinceIso, now, fetchFn, opts.board, opts.wins);
    const rec: DailyBriefingRecord = { day, generatedAt: now.toISOString(), trigger: opts.trigger, sources };
    await writeBriefingFile(briefingDayPath(this.dir, day), rec);
    return rec;
  }

  private async gatherSources(
    cfg: Config,
    sinceIso: string,
    now: Date,
    fetchFn: typeof fetch,
    board?: BoardStore,
    wins?: WinsStore,
  ): Promise<DailyBriefingSources> {
    const todoist = await this.buildTodoist(cfg, now, fetchFn);
    const weather = await this.buildWeather(cfg, fetchFn);
    const calendar = await this.buildCalendar(cfg);
    const github = await this.buildGithub(cfg);
    const boardBlock = this.buildBoard(board, wins, sinceIso, now);

    return { todoist, weather, calendar, github, board: boardBlock };
  }

  private buildBoard(
    board: BoardStore | undefined,
    wins: WinsStore | undefined,
    sinceIso: string,
    now: Date,
  ): DailyBriefingSources["board"] {
    if (!board || !wins) {
      return block("not_configured", { blocked: [], moved: [], wins: [] }, "Board data is not available.");
    }
    const blocked = board.blockedOnMe();
    const moved = board.movesSince(sinceIso);
    const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60_000), this.tz);
    const yStart = slotInstant(yesterday, "00:00", this.tz).toISOString();
    const yEnd = new Date(slotInstant(yesterday, "23:59", this.tz).getTime() + 59_999).toISOString();
    const yWins = wins.between(yStart, yEnd);
    const hasData = blocked.length || moved.length || yWins.length;
    if (!hasData) {
      return block("empty", { blocked, moved, wins: yWins }, "No board blockers, moves, or wins for yesterday.");
    }
    return block("ok", { blocked, moved, wins: yWins });
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
      return {
        status: "error",
        message: err instanceof Error ? err.message : "Weather fetch failed",
      };
    }
  }

  private async buildCalendar(cfg: Config): Promise<DailyBriefingSources["calendar"]> {
    if (!cfg.icsUrls.length && !cfg.icsLocalFiles.length) {
      return block("not_configured", { events: [] }, "Calendar is not configured — set ICS_URLS on the server.");
    }
    const snap = await fetchCalendarEvents(cfg.icsUrls, cfg.tz, { localFiles: cfg.icsLocalFiles });
    if (!snap.events.length) {
      const bad = snap.feeds.filter((f) => !f.ok);
      const msg = bad.length ? `No upcoming events (${bad.length} feed error(s)).` : "No upcoming events in the next two weeks.";
      return block("empty", { events: [] }, msg);
    }
    return block("ok", { events: snap.events });
  }

  private async buildGithub(cfg: Config): Promise<DailyBriefingSources["github"]> {
    if (!cfg.githubToken) {
      return block(
        "not_configured",
        {
          activity: {
            username: cfg.githubUsername,
            authenticated: false,
            warning: null,
            pulls: [],
            issues: [],
            events: [],
            fetchedAt: "",
          },
        },
        "",
      );
    }
    try {
      const activity = await fetchGithubActivity({ username: cfg.githubUsername, token: cfg.githubToken });
      const hasData = activity.pulls.length || activity.issues.length || activity.events.length;
      if (!hasData) {
        return block("empty", { activity }, "No open PRs, issues, or recent public activity.");
      }
      return block("ok", { activity });
    } catch (err) {
      return {
        status: "error",
        message: err instanceof Error ? err.message : "GitHub request failed",
      };
    }
  }
}
