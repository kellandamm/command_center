import type { KVStore } from "@homepage/agent-core";
import type { BuildManager } from "./build";
import type { SettingsStore } from "./settings";
import type { EditionStore } from "./store";
import { dayKey } from "./store";

/** Offset (ms) of `tz` from UTC at the given instant. */
export function tzOffsetMs(at: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant at which the wall clock in `tz` reads `day` (YYYY-MM-DD) `hhmm` (HH:MM). */
export function slotInstant(day: string, hhmm: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh, mm);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz); // second pass settles DST edges
  return new Date(t);
}

export interface SchedState {
  slot?: string; // "YYYY-MM-DD HH:MM" of the slot last attempted
  attempts?: number;
  lastAt?: string; // ISO time of last attempt
  lastStatus?: "ok" | "failed" | "cancelled" | "capped";
}

export const RETRY_AFTER_MS = 30 * 60_000;

/**
 * Which slot, if any, should run right now.
 * - Only today's most recent past slot counts: a laptop-style catch-up after a restart,
 *   but never a pile-up of yesterday's runs.
 * - A failed slot is retried once, 30 minutes later; after that it waits for the next slot.
 */
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

const KEY = "scheduler";

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  constructor(
    private d: { manager: BuildManager; settings: SettingsStore; kv: KVStore; editions: EditionStore; tz: string; now?: () => Date },
  ) {}

  start(intervalMs = 30_000) {
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Returns the slot it started a build for, if any. */
  async tick(): Promise<string | null> {
    if (this.ticking) return null;
    this.ticking = true;
    try {
      const s = this.d.settings.get();
      if (!s.scheduleEnabled || !s.times.length || this.d.manager.running) return null;
      // Never spend money unattended until a human has seen one build succeed.
      if (!(await this.d.editions.latest())) return null;
      const now = (this.d.now ?? (() => new Date()))();
      const state = (await this.d.kv.get<SchedState>(KEY)) ?? {};
      const slot = dueSlot(state, s.times, now, this.d.tz);
      if (!slot) return null;
      const started = await this.d.manager.start("schedule");
      const attempts = state.slot === slot ? (state.attempts ?? 0) + 1 : 1;
      if (!started.ok) {
        // Caps and missing config are not retried within the slot.
        await this.d.kv.set(KEY, { slot, attempts: 2, lastAt: now.toISOString(), lastStatus: "capped" } satisfies SchedState);
        return null;
      }
      await this.d.kv.set(KEY, { slot, attempts, lastAt: now.toISOString(), lastStatus: undefined } satisfies SchedState);
      void this.d.manager.idle().then(async () => {
        const last = this.d.manager.status().last;
        await this.d.kv.set(KEY, { slot, attempts, lastAt: new Date().toISOString(), lastStatus: last?.status } satisfies SchedState);
      });
      return slot;
    } finally {
      this.ticking = false;
    }
  }
}
