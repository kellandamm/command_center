import { join } from "node:path";
import { addDaysIso } from "../../budget/subscriptions/due";
import { readJson, writeFileAtomic, dayKey } from "../../store";
import { TEAM_UPDATE_RETAIN_DAYS } from "./constants";
import type { TeamUpdateAgentRow, TeamUpdateImportBody } from "./schema";

export interface TeamUpdateDayRecord {
  date: string;
  agents: TeamUpdateAgentRow[];
  importedAt: string;
}

interface TeamUpdateStoreFile {
  days: TeamUpdateDayRecord[];
}

/** Test-only override for simulating failed persistence. */
let teamUpdateWriteForTests: typeof writeFileAtomic | null = null;
export function setTeamUpdateWriteForTests(fn: typeof writeFileAtomic | null): void {
  teamUpdateWriteForTests = fn;
}

let teamUpdateNowForTests: (() => Date) | null = null;
export function setTeamUpdateNowForTests(fn: (() => Date) | null): void {
  teamUpdateNowForTests = fn;
}

function currentNow(): Date {
  return teamUpdateNowForTests?.() ?? new Date();
}

export function teamUpdateRetentionCutoffDate(now: Date, tz: string): string {
  return addDaysIso(dayKey(now, tz), -TEAM_UPDATE_RETAIN_DAYS);
}

function retainDays(rows: TeamUpdateDayRecord[], tz: string, now: Date): TeamUpdateDayRecord[] {
  const cutoff = teamUpdateRetentionCutoffDate(now, tz);
  return rows
    .filter((row) => row.date >= cutoff)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export class TeamUpdateStore {
  private data: TeamUpdateStoreFile = { days: [] };
  private queue: Promise<void> = Promise.resolve();

  private constructor(
    private path: string,
    private tz: string,
  ) {}

  static async open(dataDir: string, tz: string): Promise<TeamUpdateStore> {
    const store = new TeamUpdateStore(join(dataDir, "team-update.json"), tz);
    const saved = await readJson<TeamUpdateStoreFile>(store.path);
    if (saved && typeof saved === "object" && Array.isArray(saved.days)) {
      store.data = { days: retainDays(saved.days, store.tz, currentNow()) };
    }
    return store;
  }

  getDay(date: string): TeamUpdateDayRecord | undefined {
    return this.data.days.find((row) => row.date === date);
  }

  listDayKeys(): string[] {
    return [...this.data.days].map((row) => row.date).sort((a, b) => b.localeCompare(a));
  }

  private async mutate<T>(change: (draft: TeamUpdateStoreFile) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const next: TeamUpdateStoreFile = { days: structuredClone(this.data.days) };
      const result = change(next);
      next.days = retainDays(next.days, this.tz, currentNow());
      const writeFn = teamUpdateWriteForTests ?? writeFileAtomic;
      await writeFn(this.path, JSON.stringify(next, null, 2));
      this.data = next;
      return result;
    });
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  async importPayload(body: TeamUpdateImportBody): Promise<{ replaced: boolean; record: TeamUpdateDayRecord }> {
    return this.mutate((draft) => {
      const existing = draft.days.findIndex((row) => row.date === body.date);
      const record: TeamUpdateDayRecord = {
        date: body.date,
        agents: body.agents,
        importedAt: new Date().toISOString(),
      };
      if (existing >= 0) {
        draft.days[existing] = record;
      } else {
        draft.days.push(record);
      }
      return { replaced: existing >= 0, record };
    });
  }
}

/** @internal tests */
export function retainTeamUpdateDaysForTests(
  rows: TeamUpdateDayRecord[],
  tz: string,
  now: Date = currentNow(),
): TeamUpdateDayRecord[] {
  return retainDays(rows, tz, now);
}
