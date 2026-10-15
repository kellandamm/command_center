import type { BoardStore } from "./board/store";
import type { DailyBriefingService } from "./daily-briefing/service";
import { pollMergedPullRequestWins } from "./wins/github-poll";
import type { WinsStore } from "./wins/store";
import type { BriefingService } from "./briefing/service";
import { llmConfig, type Config } from "./config";
import { feedIdsInScope } from "./feed-scope";
import { pollDueFeeds } from "./feeds/poller";
import type { FeedsStore } from "./feeds/store";
import type { NewsPrefsStore } from "./feeds/news-prefs";
import type { SummaryService } from "./feeds/summary-service";
import type { SettingsStore } from "./settings";
import { dayKey } from "./store";

export interface KVLike {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface SchedState {
  lastFeedFetchAt?: string;
  githubWinsPollAt?: string;
  slot?: string;
  attempts?: number;
  lastAt?: string;
  lastStatus?: "ok" | "failed";
}

const KEY = "scheduler";
export const RETRY_AFTER_MS = 30 * 60_000;

export function tzOffsetMs(at: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

export function slotInstant(day: string, hhmm: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh, mm);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

export function dueBriefingSlot(state: SchedState, briefingTime: string, now: Date, tz: string): string | null {
  const day = dayKey(now, tz);
  const at = slotInstant(day, briefingTime, tz);
  if (at > now) return null;
  const key = `${day} ${briefingTime}`;
  if (state.slot !== key) return key;
  if (state.lastStatus === "failed" && (state.attempts ?? 0) < 2 && state.lastAt && now.getTime() - new Date(state.lastAt).getTime() >= RETRY_AFTER_MS) {
    return key;
  }
  return null;
}

/** Kept for tests that still import dueSlot from the old homepage scheduler API. */
export function dueSlot(state: SchedState, times: string[], now: Date, tz: string): string | null {
  const day = dayKey(now, tz);
  const past = times
    .map((t) => ({ t, at: slotInstant(day, t, tz) }))
    .filter((s) => s.at <= now)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const current = past[past.length - 1];
  if (!current) return null;
  const key = `${day} ${current.t}`;
  if (state.slot !== key) return key;
  if (state.lastStatus === "failed" && (state.attempts ?? 0) < 2 && state.lastAt && now.getTime() - new Date(state.lastAt).getTime() >= RETRY_AFTER_MS) {
    return key;
  }
  return null;
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  constructor(
    private d: {
      cfg: Config;
      settings: SettingsStore;
      kv: KVLike;
      feeds: FeedsStore;
      dailyBriefing: DailyBriefingService;
      briefing: BriefingService;
      newsPrefs: NewsPrefsStore;
      summaryService: SummaryService;
      board?: BoardStore;
      wins?: WinsStore;
      now?: () => Date;
    },
  ) {}

  start(intervalMs = 60_000) {
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = (this.d.now ?? (() => new Date()))();
      const s = this.d.settings.get();
      let state = (await this.d.kv.get<SchedState>(KEY)) ?? {};

      const fetchDue =
        !state.lastFeedFetchAt || now.getTime() - new Date(state.lastFeedFetchAt).getTime() >= s.fetchIntervalMinutes * 60_000;
      const winsPollDue =
        this.d.wins &&
        (!state.githubWinsPollAt || now.getTime() - new Date(state.githubWinsPollAt).getTime() >= 60 * 60_000);
      if (winsPollDue && this.d.wins) {
        const since = state.githubWinsPollAt ?? new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
        await pollMergedPullRequestWins({
          username: this.d.cfg.githubUsername,
          token: this.d.cfg.githubToken,
          wins: this.d.wins,
          sinceIso: since,
          now,
        });
        state = { ...state, githubWinsPollAt: now.toISOString() };
        await this.d.kv.set(KEY, state);
      }

      if (fetchDue) {
        if (this.d.feeds.feedCount() > 0) {
          const prefs = this.d.newsPrefs.get();
          const scopeIds = feedIdsInScope(this.d.feeds, s.feedScope);
          await pollDueFeeds(this.d.feeds, now, undefined, async (ids) => {
            for (const id of ids) await this.d.summaryService.maybeAutoSummarize(id, prefs, now);
          }, scopeIds);
          await this.d.feeds.save();
        }
        state = { ...state, lastFeedFetchAt: now.toISOString() };
        await this.d.kv.set(KEY, state);
      }

      const slot = dueBriefingSlot(state, s.briefingTime, now, this.d.cfg.tz);
      if (slot) {
        const rec = await this.d.dailyBriefing.generate({
          cfg: this.d.cfg,
          feeds: this.d.feeds,
          board: this.d.board,
          wins: this.d.wins,
          feedScope: s.feedScope,
          trigger: "schedule",
          now,
        });
        let failed = rec.sources.ai.status === "error";
        const llm = llmConfig(this.d.cfg);
        if (llm) {
          const since = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
          const briefing = await this.d.briefing.generate({
            llm,
            feeds: this.d.feeds,
            sinceIso: since,
            trigger: "schedule",
            now,
            feedIds: feedIdsInScope(this.d.feeds, s.feedScope),
          });
          failed ||= Boolean(briefing.error);
        }
        const attempts = state.slot === slot ? (state.attempts ?? 0) + 1 : 1;
        state = {
          ...state,
          slot,
          attempts,
          lastAt: now.toISOString(),
          lastStatus: failed ? "failed" : "ok",
        };
        await this.d.kv.set(KEY, state);
      }
    } finally {
      this.ticking = false;
    }
  }
}
