import { createHash } from "node:crypto";
import { join } from "node:path";
import { readJson, writeFileAtomic } from "../store";
import { USAGE_SNAPSHOT_HISTORY_MAX } from "./constants";
import type { AgentsUsageStoreFile, UsageCheckin, UsageSnapshot } from "./types";
import type { UsageImportBody } from "./schema";

function checkinKey(row: UsageCheckin): string {
  return createHash("sha256").update(`${row.bot}\0${row.date}\0${row.note}`).digest("hex").slice(0, 32);
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
        snapshots: Array.isArray(saved.snapshots) ? saved.snapshots : [],
        checkins: Array.isArray(saved.checkins) ? saved.checkins : [],
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

  /**
   * Import snapshot (idempotent on `asOf`: replaces existing row).
   * Check-ins upsert on (bot, date): latest import wins for that pair.
   */
  async importPayload(body: UsageImportBody): Promise<{ duplicate: boolean; snapshot: UsageSnapshot }> {
    const existing = this.getSnapshot(body.asOf);
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
      const idx = this.data.snapshots.findIndex((s) => s.asOf === body.asOf);
      this.data.snapshots[idx] = snapshot;
    } else {
      this.data.snapshots.push(snapshot);
      this.data.snapshots.sort((a, b) => a.asOf.localeCompare(b.asOf));
      if (this.data.snapshots.length > USAGE_SNAPSHOT_HISTORY_MAX) {
        this.data.snapshots = this.data.snapshots.slice(-USAGE_SNAPSHOT_HISTORY_MAX);
      }
    }

    if (body.checkins?.length) {
      const byPair = new Map<string, UsageCheckin>();
      for (const row of this.data.checkins) {
        byPair.set(`${row.bot}\0${row.date}`, row);
      }
      for (const row of body.checkins) {
        byPair.set(`${row.bot}\0${row.date}`, row);
      }
      this.data.checkins = [...byPair.values()];
    }

    await this.flush();
    return { duplicate: Boolean(existing), snapshot };
  }

  /** Daily log rows derived from snapshot history (newest first). */
  dailyLog(limit = 60): Array<{ asOf: string; weeklyPercentUsed: number | null; resetsAt: string | null }> {
    return [...this.data.snapshots]
      .sort((a, b) => b.asOf.localeCompare(a.asOf))
      .slice(0, limit)
      .map((s) => ({ asOf: s.asOf, weeklyPercentUsed: s.weeklyPercentUsed, resetsAt: s.resetsAt }));
  }

  checkinDedupeKeys(): string[] {
    return this.data.checkins.map((c) => checkinKey(c));
  }

  private flush(): Promise<void> {
    const run = this.queue.then(() => writeFileAtomic(this.path, JSON.stringify(this.data, null, 2)));
    this.queue = run.catch(() => {});
    return run;
  }
}
