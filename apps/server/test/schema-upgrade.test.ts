import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../src/feeds/schema";

test("schema upgrade: parent_id column and idx_folders_parent after legacy folders table", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL)`);
  db.exec(`INSERT INTO folders (id, name, sort_order) VALUES ('f1', 'Legacy', 0)`);

  initSchema(db);

  const cols = db.prepare(`PRAGMA table_info(folders)`).all() as { name: string }[];
  assert.ok(cols.some((c) => c.name === "parent_id"), "parent_id column missing after initSchema");

  const indexes = db.prepare(`PRAGMA index_list(folders)`).all() as { name: string }[];
  assert.ok(
    indexes.some((i) => i.name === "idx_folders_parent"),
    "idx_folders_parent missing after initSchema",
  );

  initSchema(db);
});
