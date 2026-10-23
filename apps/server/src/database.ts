import type { DatabaseSync } from "node:sqlite";

/** The legacy filename is retained so existing Board and Wins records stay in place. */
export const DATABASE_FILE = "rss.sqlite";

export function initSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      column TEXT NOT NULL,
      position INTEGER NOT NULL,
      hobie_task_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column, position);
    CREATE TABLE IF NOT EXISTS card_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      from_col TEXT,
      to_col TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_card_events_at ON card_events(at DESC);
    CREATE INDEX IF NOT EXISTS idx_card_events_card ON card_events(card_id, at DESC);
    CREATE TABLE IF NOT EXISTS wins (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK(source IN ('card', 'pr', 'manual')),
      ref TEXT NOT NULL,
      title TEXT NOT NULL,
      at TEXT NOT NULL,
      UNIQUE(source, ref)
    );
    CREATE INDEX IF NOT EXISTS idx_wins_at ON wins(at DESC);
    CREATE TABLE IF NOT EXISTS win_week_summaries (
      iso_week TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const columns = new Set((db.prepare("PRAGMA table_info(cards)").all() as { name: string }[]).map((row) => row.name));
  for (const [name, definition] of [
    ["estimated_minutes", "INTEGER"],
    ["due_date", "TEXT"],
    ["priority", "TEXT NOT NULL DEFAULT 'normal'"],
    ["version", "INTEGER NOT NULL DEFAULT 1"],
  ] as const) {
    if (!columns.has(name)) db.exec(`ALTER TABLE cards ADD COLUMN ${name} ${definition}`);
  }
}
