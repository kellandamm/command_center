import type { Config } from "../config";
import type { DailyBriefingRecord } from "../daily-briefing/types";
import type { NtfySentSet } from "./sent-set";
import { runNtfyTick, sendBriefingDigest, type NtfyTickDeps } from "./tick";
import type { CalendarWorkspace } from "../calendar/workspace";
import type { BoardStore } from "../board/store";
import type { NotesStore } from "../notes/store";
import type { WinsStore } from "../wins/store";
import type { AttentionStore } from "../attention/store";

export interface NtfySchedulerHooks {
  deployment: Config;
  cfg: Config;
  ntfySent: NtfySentSet;
  calendar?: CalendarWorkspace;
  board?: BoardStore;
  notes?: NotesStore;
  wins?: WinsStore;
  attention?: AttentionStore;
}

let lastBackgroundErrorAt = 0;

export class NtfyBackgroundRunner {
  private busy = false;
  private readonly queue: Array<() => Promise<void>> = [];

  private deps(now: Date, hooks: NtfySchedulerHooks): NtfyTickDeps {
    return {
      deployment: hooks.deployment,
      effective: hooks.cfg,
      calendar: hooks.calendar,
      board: hooks.board,
      notes: hooks.notes,
      wins: hooks.wins,
      attention: hooks.attention,
      sent: hooks.ntfySent,
      now,
    };
  }

  scheduleBriefingDigest(hooks: NtfySchedulerHooks, rec: DailyBriefingRecord, slot: string, now: Date): void {
    this.enqueue(async () => {
      await sendBriefingDigest(this.deps(now, hooks), rec, slot);
    });
  }

  scheduleTick(hooks: NtfySchedulerHooks, now: Date): void {
    this.enqueue(async () => {
      await runNtfyTick(this.deps(now, hooks));
    });
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue.push(work);
    this.pump();
  }

  private pump(): void {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    const work = this.queue.shift()!;
    void work()
      .catch(() => {
        const now = Date.now();
        if (now - lastBackgroundErrorAt >= 15 * 60_000) {
          console.error("ntfy: background work failed");
          lastBackgroundErrorAt = now;
        }
      })
      .finally(() => {
        this.busy = false;
        this.pump();
      });
  }
}
