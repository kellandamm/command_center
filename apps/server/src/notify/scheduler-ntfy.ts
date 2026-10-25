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

export class NtfyBackgroundRunner {
  private busy = false;

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
    this.run(async () => {
      await sendBriefingDigest(this.deps(now, hooks), rec, slot);
    });
  }

  scheduleTick(hooks: NtfySchedulerHooks, now: Date): void {
    this.run(async () => {
      await runNtfyTick(this.deps(now, hooks));
    });
  }

  private run(work: () => Promise<void>): void {
    if (this.busy) return;
    this.busy = true;
    void work()
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "unknown error";
        console.error(`ntfy background work failed: ${msg}`);
      })
      .finally(() => {
        this.busy = false;
      });
  }
}
