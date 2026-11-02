import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DAY_PLAN_DB, initDayPlanSchema } from "./db";
import type { DayPlanSnapshot } from "./types";

export class DayPlanStore {
  private constructor(private db: DatabaseSync) {}

  static open(dataDir: string): DayPlanStore {
    const db = new DatabaseSync(join(dataDir, DAY_PLAN_DB));
    initDayPlanSchema(db);
    return new DayPlanStore(db);
  }

  close(): void {
    this.db.close();
  }

  save(snapshot: DayPlanSnapshot): void {
    const delItems = this.db.prepare(`DELETE FROM plan_items WHERE day = ?`);
    const delMust = this.db.prepare(`DELETE FROM plan_must_dos WHERE day = ?`);
    const delDay = this.db.prepare(`DELETE FROM plan_days WHERE day = ?`);
    delItems.run(snapshot.day);
    delMust.run(snapshot.day);
    delDay.run(snapshot.day);
    this.db
      .prepare(
        `INSERT INTO plan_days (day, timezone, work_start, work_end, generated_at, generated_by, theme, capacity_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.day,
        snapshot.timezone,
        snapshot.workStart,
        snapshot.workEnd,
        snapshot.generatedAt,
        snapshot.generatedBy,
        snapshot.theme,
        JSON.stringify(snapshot.capacity),
      );
    const insItem = this.db.prepare(
      `INSERT INTO plan_items (id, day, kind, source, ref_id, title, start_iso, end_iso, sort_order, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of snapshot.items) {
      insItem.run(
        item.id,
        snapshot.day,
        item.kind,
        item.source,
        item.refId,
        item.title,
        item.startIso,
        item.endIso,
        item.sortOrder,
        item.completedAt,
      );
    }
    const insMust = this.db.prepare(
      `INSERT INTO plan_must_dos (day, slot, source, ref_id, title, user_locked, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const m of snapshot.mustDos) {
      insMust.run(snapshot.day, m.slot, m.source, m.refId, m.title, m.userLocked ? 1 : 0, m.completedAt);
    }
  }

  load(day: string): DayPlanSnapshot | null {
    const row = this.db.prepare(`SELECT * FROM plan_days WHERE day = ?`).get(day) as Record<string, unknown> | undefined;
    if (!row) return null;
    const items = this.db
      .prepare(`SELECT * FROM plan_items WHERE day = ? ORDER BY sort_order`)
      .all(day) as Record<string, unknown>[];
    const mustRows = this.db
      .prepare(`SELECT * FROM plan_must_dos WHERE day = ? ORDER BY slot`)
      .all(day) as Record<string, unknown>[];
    const mustDos = mustRows.map((m) => ({
      slot: Number(m.slot),
      source: String(m.source) as DayPlanSnapshot["mustDos"][number]["source"],
      refId: String(m.ref_id),
      title: String(m.title),
      userLocked: Boolean(m.user_locked),
      completedAt: m.completed_at ? String(m.completed_at) : null,
    }));
    const capacity = JSON.parse(String(row.capacity_json)) as DayPlanSnapshot["capacity"];
    return {
      day: String(row.day),
      timezone: String(row.timezone),
      workStart: String(row.work_start),
      workEnd: String(row.work_end),
      generatedAt: String(row.generated_at),
      generatedBy: String(row.generated_by) as DayPlanSnapshot["generatedBy"],
      theme: row.theme == null ? null : String(row.theme),
      capacity,
      mustDos,
      items: items.map((i) => ({
        id: String(i.id),
        kind: String(i.kind) as DayPlanSnapshot["items"][number]["kind"],
        source: i.source ? (String(i.source) as DayPlanSnapshot["items"][number]["source"]) : null,
        refId: i.ref_id ? String(i.ref_id) : null,
        title: String(i.title),
        startIso: i.start_iso ? String(i.start_iso) : null,
        endIso: i.end_iso ? String(i.end_iso) : null,
        sortOrder: Number(i.sort_order),
        completedAt: i.completed_at ? String(i.completed_at) : null,
      })),
      alternates: [],
      rolledToTomorrow: [],
    };
  }
}
