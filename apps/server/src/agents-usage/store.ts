import { join } from "node:path";
import { ValidationError } from "../settings";
import { readJson, writeFileAtomic } from "../store";
import {
  USAGE_CHECKIN_MAX_PER_BOT,
  USAGE_CHECKIN_MAX_TOTAL,
  USAGE_CHECKIN_RETAIN_DAYS,
  USAGE_SNAPSHOT_HISTORY_MAX,
} from "./constants";
import type { AgentsUsageStoreFile, UsageCheckin, UsageSnapshot } from "./types";
import type { UsageImportBody } from "./schema";

/** Test-only override for simulating failed persistence. */
let agentsUsageWriteForTests: typeof writeFileAtomic | null = null;
export function setAgentsUsageWriteForTests(fn: typeof writeFileAtomic | null): void {
  agentsUsageWriteForTests = fn;
}

export function checkinRetentionCutoffDate(now = new Date()): string {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - USAGE_CHECKIN_RETAIN_DAYS);
  return cutoff.toISOString().slice(0, 10);
}

function retainCheckins(rows: UsageCheckin[]): UsageCheckin[] {
  const cutoffKey = checkinRetentionCutoffDate();
  const fresh = rows.filter((r) => r.date >= cutoffKey);
  const byBot = new Map<string, UsageCheckin[]>();
  for (const row of fresh) {
    const list = byBot.get(row.bot) ?? [];
    list.push(row);
    byBot.set(row.bot, list);
  }
  const out: UsageCheckin[] = [];
  for (const list of byBot.values()) {
    list.sort((a, b) => b.date.localeCompare(a.date) || b.bot.localeCompare(a.bot));
    out.push(...list.slice(0, USAGE_CHECKIN_MAX_PER_BOT));
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || a.bot.localeCompare(b.bot));
  return out.length > USAGE_CHECKIN_MAX_TOTAL ? out.slice(0, USAGE_CHECKIN_MAX_TOTAL) : out;
}

function trimSnapshots(rows: UsageSnapshot[]): UsageSnapshot[] {
  const sorted = [...rows].sort((a, b) => a.asOf.localeCompare(b.asOf));
  return sorted.length > USAGE_SNAPSHOT_HISTORY_MAX ? sorted.slice(-USAGE_SNAPSHOT_HISTORY_MAX) : sorted;
}

export class AgentsUsageStore {
  private data: AgentsUsageStoreFile = { snapshots: [], checkins: [] };
  private queue: Promise<void> = Promise.resolve();

  private constructor(private path: string) {}

  static async open(dataDir: string): Promise<AgentsUsageStore> {
    const store = new AgentsUsageStore(join(dataDir, "agents-usage.json"));
    const saved = await readJson<AgentsUsageStoreFile>(store.path);
    if (saved && typeof saved === "object") {
      store.data = {
        snapshots: Array.isArray(saved.snapshots) ? trimSnapshots(saved.snapshots) : [],
        checkins: Array.isArray(saved.checkins) ? retainCheckins(saved.checkins) : [],
      };
    }
    return store;
  }

  listSnapshots(): UsageSnapshot[] {
    return [...this.data.snapshots].sort((a, b) => a.asOf.localeCompare(b.asOf));
  }

  getSnapshot(asOf: string): UsageSnapshot | undefined {
    return this.data.snapshots.find((s) => s.asOf === asOf);
  }

  latestSnapshot(): UsageSnapshot | undefined {
    const rows = this.listSnapshots();
    return rows.length ? rows[rows.length - 1] : undefined;
  }

  listCheckins(): UsageCheckin[] {
    return [...this.data.checkins];
  }

  private async mutate<T>(change: (draft: AgentsUsageStoreFile) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const next: AgentsUsageStoreFile = {
        snapshots: structuredClone(this.data.snapshots),
        checkins: structuredClone(this.data.checkins),
      };
      const result = change(next);
      next.snapshots = trimSnapshots(next.snapshots);
      next.checkins = retainCheckins(next.checkins);
      const writeFn = agentsUsageWriteForTests ?? writeFileAtomic;
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

  async importPayload(body: UsageImportBody): Promise<{ duplicate: boolean; snapshot: UsageSnapshot }> {
    const cutoff = checkinRetentionCutoffDate();
    if (body.checkins?.some((row) => row.date < cutoff)) {
      throw new ValidationError("check-in date outside retention window");
    }

    return this.mutate((draft) => {
      const existing = draft.snapshots.find((s) => s.asOf === body.asOf);
      const snapshot: UsageSnapshot = {
        asOf: body.asOf,
        weeklyPercentUsed: body.weeklyPercentUsed,
        resetsAt: body.resetsAt,
        onDemand: body.onDemand,
        byBot: body.byBot,
        byRoutine: body.byRoutine,
        byDay: body.byDay,
        importedAt: new Date().toISOString(),
      };

      if (existing) {
        const idx = draft.snapshots.findIndex((s) => s.asOf === body.asOf);
        draft.snapshots[idx] = snapshot;
      } else {
        draft.snapshots.push(snapshot);
        draft.snapshots.sort((a, b) => a.asOf.localeCompare(b.asOf));
      }

      if (body.checkins?.length) {
        const byPair = new Map<string, UsageCheckin>();
        for (const row of draft.checkins) {
          byPair.set(`${row.bot}\0${row.date}`, row);
        }
        for (const row of body.checkins) {
          byPair.set(`${row.bot}\0${row.date}`, row);
        }
        draft.checkins = [...byPair.values()];
      }

      return { duplicate: Boolean(existing), snapshot };
    });
  }

  dailyLog(limit = 60): Array<{ asOf: string; weeklyPercentUsed: number | null; resetsAt: string | null }> {
    return [...this.data.snapshots]
      .sort((a, b) => b.asOf.localeCompare(a.asOf))
      .slice(0, limit)
      .map((s) => ({ asOf: s.asOf, weeklyPercentUsed: s.weeklyPercentUsed, resetsAt: s.resetsAt }));
  }
}

/** @internal tests */
export function retainCheckinsForTests(rows: UsageCheckin[]): UsageCheckin[] {
  return retainCheckins(rows);
}
