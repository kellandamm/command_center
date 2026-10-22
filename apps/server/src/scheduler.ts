import type { BoardStore } from "./board/store";
import type { DailyBriefingService } from "./daily-briefing/service";
import { pollMergedPullRequestWins } from "./wins/github-poll";
import type { WinsStore } from "./wins/store";
import type { Config } from "./config";
import type { SettingsStore } from "./settings";
import { dayKey } from "./store";
import type { CalendarWorkspace } from "./calendar/workspace";

export interface KVLike {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface SchedState {
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

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  constructor(
    private d: {
      cfg: Config;
      settings: SettingsStore;
      kv: KVLike;
      dailyBriefing: DailyBriefingService;
      board?: BoardStore;
      wins?: WinsStore;
      calendar?: CalendarWorkspace;
      now?: () => Date;
    },
  ) {}

  start(intervalMs = 60_000) {
    const tick = () => { void this.tick().catch((err) => console.error("scheduler tick failed:", err)); };
    this.timer = setInterval(tick, intervalMs);
    tick();
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

      const winsPollDue =
        this.d.wins &&
        (!state.githubWinsPollAt || now.getTime() - new Date(state.githubWinsPollAt).getTime() >= 60 * 60_000);
      if (winsPollDue && this.d.wins) {
        const since = state.githubWinsPollAt ?? new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
        try {
          await pollMergedPullRequestWins({
            username: this.d.cfg.githubUsername,
            token: this.d.cfg.githubToken,
            wins: this.d.wins,
            sinceIso: since,
            now,
          });
          state = { ...state, githubWinsPollAt: now.toISOString() };
          await this.d.kv.set(KEY, state);
        } catch (err) {
          console.error("GitHub wins poll failed:", err);
        }
      }

      const slot = dueBriefingSlot(state, s.briefingTime, now, this.d.cfg.tz);
      if (slot) {
        const rec = await this.d.dailyBriefing.generate({
          cfg: this.d.cfg,
          topics: s.briefingTopics,
          calendar: this.d.calendar,
          trigger: "schedule",
          now,
        });
        const failed = Object.values(rec.sources).some((source) => source.status === "error");
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
