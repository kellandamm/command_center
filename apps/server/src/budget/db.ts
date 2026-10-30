import { chmodSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BUDGET_DATABASE_FILE } from "./constants";
import { BUDGET_MIGRATIONS } from "./migrations";
import { BudgetStore } from "./store";

export function runBudgetMigrations(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  const hasVersion = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_version'").get();
  const current = hasVersion
    ? (db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null })
    : { v: 0 };
  const version = current?.v ?? 0;
  for (const m of BUDGET_MIGRATIONS) {
    if (m.version <= version) continue;
    db.exec(m.sql);
    db.prepare("INSERT INTO schema_version (version, description, applied_at) VALUES (?, ?, ?)").run(
      m.version,
      m.description,
      new Date().toISOString(),
    );
  }
}

export function openBudgetDatabase(dataDir: string): DatabaseSync {
  const path = join(dataDir, BUDGET_DATABASE_FILE);
  const db = new DatabaseSync(path);
  runBudgetMigrations(db);
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort on platforms that support it
  }
  return db;
}

export { BudgetStore };
