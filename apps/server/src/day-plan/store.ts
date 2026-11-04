import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DAY_PLAN_DB, initDayPlanSchema, type DayPlanLlmSlot } from "./db";
import type { DayPlanSnapshot } from "./types";

/** Test hook: throw while inserting plan_items at this zero-based index. */
let saveFailAtItemIndex: number | null = null;

export function __setSaveFailAtItemIndex(index: number | null): void {
  saveFailAtItemIndex = index;
}

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

  /** Atomically claim an LLM attempt slot; survives plan_days delete/reinsert in save(). */
  claimLlmAttempt(day: string, slot: DayPlanLlmSlot, attemptedAt: string): boolean {
    const r = this.db
      .prepare(`INSERT INTO plan_llm_attempts (day, slot, attempted_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`)
      .run(day, slot, attemptedAt);
    return r.changes === 1;
  }

  hasLlmAttempt(day: string, slot: DayPlanLlmSlot): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM plan_llm_attempts WHERE day = ? AND slot = ?`).get(day, slot));
  }

  save(snapshot: DayPlanSnapshot): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`DELETE FROM plan_items WHERE day = ?`).run(snapshot.day);
      this.db.prepare(`DELETE FROM plan_must_dos WHERE day = ?`).run(snapshot.day);
      this.db.prepare(`DELETE FROM plan_days WHERE day = ?`).run(snapshot.day);
      this.db
        .prepare(
          `INSERT INTO plan_days (day, timezone, work_start, work_end, weekend_override, generated_at, generated_by, theme, capacity_json, sources_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          snapshot.day,
          snapshot.timezone,
          snapshot.workStart,
          snapshot.workEnd,
          snapshot.weekendOverride ? 1 : 0,
          snapshot.generatedAt,
          snapshot.generatedBy,
          snapshot.theme,
          JSON.stringify(snapshot.capacity),
          JSON.stringify(snapshot.sources),
        );
      const insItem = this.db.prepare(
        `INSERT INTO plan_items (id, day, kind, source, ref_id, title, start_iso, end_iso, sort_order, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      let itemIndex = 0;
      for (const item of snapshot.items) {
        if (saveFailAtItemIndex !== null && itemIndex === saveFailAtItemIndex) {
          throw new Error("day-plan save test abort");
        }
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
        itemIndex++;
      }
      const insMust = this.db.prepare(
        `INSERT INTO plan_must_dos (day, slot, source, ref_id, title, user_locked, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const m of snapshot.mustDos) {
        insMust.run(snapshot.day, m.slot, m.source, m.refId, m.title, m.userLocked ? 1 : 0, m.completedAt);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Patch must-do completion without replanning; returns null when day or slot is missing. */
  patchMustDoCompletion(day: string, slot: number, completedAt: string | null): DayPlanSnapshot | null {
    const plan = this.load(day);
    if (!plan) return null;
    const must = plan.mustDos.find((m) => m.slot === slot);
    if (!must) return null;
    must.completedAt = completedAt;
    for (const item of plan.items) {
      if (item.kind === "task" && item.source === must.source && item.refId === must.refId) {
        item.completedAt = completedAt;
      }
    }
    this.save(plan);
    return this.load(day);
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
    const sources = JSON.parse(String(row.sources_json ?? "{}")) as DayPlanSnapshot["sources"];
    return {
      day: String(row.day),
      timezone: String(row.timezone),
      workStart: String(row.work_start),
      workEnd: String(row.work_end),
      weekendOverride: Boolean(row.weekend_override),
      generatedAt: String(row.generated_at),
      generatedBy: String(row.generated_by) as DayPlanSnapshot["generatedBy"],
      theme: row.theme == null ? null : String(row.theme),
      capacity,
      sources,
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
