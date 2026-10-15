import type { DatabaseSync } from "node:sqlite";

export function tryEnableFts5(db: DatabaseSync): boolean {
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS _fts_probe USING fts5(x)");
    db.exec("DROP TABLE IF EXISTS _fts_probe");
    return true;
  } catch {
    return false;
  }
}

export function initSchema(db: DatabaseSync): { fts5: boolean } {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
  `);
  try {
    db.exec(`ALTER TABLE folders ADD COLUMN parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL`);
  } catch {
    /* column exists */
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS feeds (
      id TEXT PRIMARY KEY,
      folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      xml_url TEXT NOT NULL UNIQUE,
      html_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      etag TEXT,
      last_modified TEXT,
      next_poll_at TEXT NOT NULL,
      fail_streak INTEGER NOT NULL DEFAULT 0,
      last_fetch_at TEXT,
      last_error TEXT,
      is_hn INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      guid TEXT,
      link TEXT,
      title TEXT NOT NULL,
      snippet TEXT,
      content_html TEXT,
      thumb_url TEXT,
      duration_sec INTEGER,
      published_at TEXT,
      first_seen_at TEXT NOT NULL,
      read_at TEXT,
      starred INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_entries_feed_seen ON entries(feed_id, first_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_entries_starred ON entries(starred, first_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_feeds_next_poll ON feeds(next_poll_at);
  `);
  const fts5 = tryEnableFts5(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      entry_id TEXT,
      dedupe_key TEXT NOT NULL UNIQUE,
      url TEXT,
      title TEXT NOT NULL,
      feed_name TEXT,
      folder_name TEXT,
      summary TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_summaries_created ON summaries(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_summaries_entry ON summaries(entry_id);
  `);
  if (fts5) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entry_fts USING fts5(
        entry_id UNINDEXED,
        title,
        snippet,
        feed_title,
        tokenize='porter'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS summary_fts USING fts5(
        summary_id UNINDEXED,
        title,
        summary,
        feed_name,
        folder_name,
        tokenize='porter'
      );
    `);
  }
  db.exec(`
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
  return { fts5 };
}
