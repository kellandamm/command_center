export interface Migration {
  version: number;
  description: string;
  sql: string;
}

export const BUDGET_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "core budget schema",
    sql: `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS category_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  is_income INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES category_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('checking','savings','credit','cash','investment')),
  institution TEXT,
  last4 TEXT CHECK(last4 IS NULL OR length(last4)=4),
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  opening_date TEXT,
  current_balance_cents INTEGER,
  invert_sign INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS budget_months (
  month TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  budgeted_cents INTEGER NOT NULL,
  PRIMARY KEY (month, category_id)
);
CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  file_name TEXT,
  file_sha256 TEXT NOT NULL,
  rows_total INTEGER NOT NULL,
  rows_added INTEGER NOT NULL,
  rows_skipped INTEGER NOT NULL,
  mapping_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  undone_at TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  payee TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  transfer_account_id TEXT REFERENCES accounts(id),
  cleared INTEGER NOT NULL DEFAULT 1,
  import_batch_id TEXT REFERENCES import_batches(id) ON DELETE CASCADE,
  fingerprint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_fingerprint ON transactions(account_id, fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_cat ON transactions(category_id, date);
CREATE TABLE IF NOT EXISTS payee_rules (
  id TEXT PRIMARY KEY,
  match TEXT NOT NULL,
  match_kind TEXT NOT NULL CHECK(match_kind IN ('contains','equals','starts')),
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS csv_profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  mapping_json TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    description: "budget prefs",
    sql: `
CREATE TABLE IF NOT EXISTS budget_prefs (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO budget_prefs (key, value) VALUES ('over_budget_notify', '0');
`,
  },
  {
    version: 3,
    description: "subscriptions and recurring detections",
    sql: `
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  payee_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  cadence TEXT NOT NULL CHECK(cadence IN ('weekly','monthly','yearly')),
  anchor_date TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL CHECK(source IN ('detected','manual')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscription_detections (
  id TEXT PRIMARY KEY,
  payee_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  cadence TEXT NOT NULL CHECK(cadence IN ('weekly','monthly','yearly')),
  detection_kind TEXT NOT NULL CHECK(detection_kind IN ('standard','possible_yearly')),
  confidence REAL NOT NULL,
  sample_dates_json TEXT NOT NULL,
  lane_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','dismissed')),
  dismissed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscription_detections_lane ON subscription_detections(lane_key);
CREATE INDEX IF NOT EXISTS idx_subscription_detections_pending ON subscription_detections(status) WHERE status = 'pending';
`,
  },
];
