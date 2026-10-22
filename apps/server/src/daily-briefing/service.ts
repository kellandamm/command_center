import { join } from "node:path";
import type { Config } from "../config";
import { fetchCalendarEvents } from "../calendar/service";
import { dayKey } from "../store";
import { fetchOpenMeteo } from "../weather/open-meteo";
import { briefingDayPath, ensureBriefingDir, listBriefingDays, readBriefingFile, writeBriefingFile } from "./storage";
import { buildTopics } from "./topics";
import type { DailyBriefingRecord, DailyBriefingSources } from "./types";
import type { CalendarWorkspace } from "../calendar/workspace";

export class DailyBriefingService {
  private dir: string;
  private inFlight = new Map<string, Promise<DailyBriefingRecord>>();
  private generationError: { day: string; message: string } | null = null;

  constructor(dataDir: string, private tz: string) {
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

  generationState(day: string): { status: "generating" | "idle" | "error"; message?: string } {
    if (this.inFlight.has(day)) return { status: "generating" };
    if (this.generationError?.day === day) return { status: "error", message: this.generationError.message };
    return { status: "idle" };
  }

  generate(opts: {
    cfg: Config;
    topics?: readonly string[];
    trigger: "schedule" | "manual";
    now?: Date;
    fetchFn?: typeof fetch;
    calendar?: CalendarWorkspace;
  }): Promise<DailyBriefingRecord> {
    const now = opts.now ?? new Date();
    const day = dayKey(now, this.tz);
    const running = this.inFlight.get(day);
    if (running) return running;
    this.generationError = null;
    const fetchFn = opts.fetchFn ?? fetch;
    const run = Promise.all([
      this.buildWeather(opts.cfg, fetchFn),
      this.buildCalendar(opts.cfg, opts.calendar),
      buildTopics(opts.cfg, opts.topics ?? [], fetchFn),
    ]).then(async ([weather, calendar, topics]) => {
      const rec: DailyBriefingRecord = {
        day, generatedAt: now.toISOString(), trigger: opts.trigger, sources: { weather, calendar, topics },
      };
      await writeBriefingFile(briefingDayPath(this.dir, day), rec);
      return rec;
    }).catch((err: unknown) => {
      this.generationError = { day, message: err instanceof Error ? err.message : "Could not save the briefing. Check server logs and retry." };
      throw err;
    }).finally(() => this.inFlight.delete(day));
    this.inFlight.set(day, run);
    return run;
  }

  private async buildWeather(cfg: Config, fetchFn: typeof fetch): Promise<DailyBriefingSources["weather"]> {
    try {
      const weather = await fetchOpenMeteo(cfg.weatherLat, cfg.weatherLon, cfg.tz, fetchFn);
      return { status: "ok", data: { weather, lat: cfg.weatherLat, lon: cfg.weatherLon } };
    } catch (err) {
      return { status: "error", message: err instanceof Error ? err.message : "Weather fetch failed" };
    }
  }

  private async buildCalendar(cfg: Config, calendar?: CalendarWorkspace): Promise<DailyBriefingSources["calendar"]> {
    if (!calendar && !cfg.icsUrls.length && !cfg.icsLocalFiles.length) {
      return { status: "not_configured", data: { events: [] }, message: "Calendar is not configured - set ICS_URLS on the server." };
    }
    try {
      const snap = calendar ? await calendar.snapshot() : await fetchCalendarEvents(cfg.icsUrls, cfg.tz, { localFiles: cfg.icsLocalFiles });
      if (!snap.configured) return { status: "not_configured", data: { events: [] }, message: "Add a calendar in Settings > Calendars." };
      const failed = snap.feeds.filter((feed) => !feed.ok).length;
      return {
        status: failed ? "error" : snap.events.length ? "ok" : "empty",
        data: { events: snap.events },
        message: failed ? `${failed} calendar feed(s) could not be loaded. Check Settings > Calendars.` : undefined,
      };
    } catch (err) {
      return { status: "error", message: err instanceof Error ? err.message : "Calendar fetch failed" };
    }
  }
}
