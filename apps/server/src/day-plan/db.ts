import type { DatabaseSync } from "node:sqlite";

export const DAY_PLAN_DB = "day-plan.sqlite";
export const DAY_PLAN_SCHEMA_VERSION = 1;

export function initDayPlanSchema(db: DatabaseSync): void {
  db.exec(`PRAGMA user_version = ${DAY_PLAN_SCHEMA_VERSION}`);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS plan_days (
      day TEXT PRIMARY KEY,
      timezone TEXT NOT NULL,
      work_start TEXT NOT NULL,
      work_end TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      generated_by TEXT NOT NULL CHECK(generated_by IN ('deterministic', 'llm')),
      theme TEXT,
      capacity_json TEXT NOT NULL,
      sources_json TEXT NOT NULL DEFAULT '{}',
      llm_attempted_at TEXT,
      llm_generated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS plan_items (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL REFERENCES plan_days(day) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      source TEXT,
      ref_id TEXT,
      title TEXT NOT NULL,
      start_iso TEXT,
      end_iso TEXT,
      sort_order INTEGER NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_plan_items_day ON plan_items(day, sort_order);
    CREATE TABLE IF NOT EXISTS plan_must_dos (
      day TEXT NOT NULL REFERENCES plan_days(day) ON DELETE CASCADE,
      slot INTEGER NOT NULL CHECK(slot >= 0 AND slot <= 2),
      source TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      title TEXT NOT NULL,
      user_locked INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      PRIMARY KEY (day, slot)
    );
  `);
  const cols = new Set((db.prepare("PRAGMA table_info(plan_days)").all() as { name: string }[]).map((r) => r.name));
  if (!cols.has("sources_json")) db.exec(`ALTER TABLE plan_days ADD COLUMN sources_json TEXT NOT NULL DEFAULT '{}'`);
  if (!cols.has("llm_attempted_at")) db.exec(`ALTER TABLE plan_days ADD COLUMN llm_attempted_at TEXT`);
  if (!cols.has("llm_generated_at")) db.exec(`ALTER TABLE plan_days ADD COLUMN llm_generated_at TEXT`);
}
