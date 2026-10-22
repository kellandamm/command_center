import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { BoardStore } from "../src/board/store";
import { READY_FOR_HOBIE, WAITING, DONE } from "../src/board/types";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { initSchema } from "../src/database";
import { loadConfig } from "../src/config";
import { HobieQueueStore } from "../src/stores/hobie-queue";
import { wireHobieBoardSync } from "../src/board/hobie-sync";
import { pollMergedPullRequestWins } from "../src/wins/github-poll";
import { WinsStore } from "../src/wins/store";

test("board: move to Ready creates Hobie task; claim → Waiting; done → Done + one win", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-board-"));
  const board = BoardStore.open(dir);
  const wins = WinsStore.open(dir);
  try {
    const hobie = await HobieQueueStore.open(dir);
    wireHobieBoardSync(hobie, board, wins);
    const cfg = loadConfig({ ADMIN_TOKEN: "t".repeat(32), ALLOW_INSECURE_NO_AUTH: "1", DATA_DIR: dir });

    const card = board.create({ title: "Ship board", notes: "details" });
    const moved = await board.move(card.id, READY_FOR_HOBIE, { hobieQueue: hobie, maxHobiePending: cfg.mcpMaxHobiePending, wins });
    assert.ok(moved?.hobieTaskId);
    assert.equal(hobie.list({ status: "pending" }).length, 1);

    const claimed = await hobie.claim(moved!.hobieTaskId!);
    assert.ok(claimed);
    await new Promise((r) => setTimeout(r, 20));
    const afterClaim = board.get(card.id)!;
    assert.equal(afterClaim.column, WAITING);

    await hobie.markDone(moved!.hobieTaskId!);
    await new Promise((r) => setTimeout(r, 20));
    const afterDone = board.get(card.id)!;
    assert.equal(afterDone.column, DONE);
    const winRows = wins.list().filter((w) => w.source === "card" && w.ref === card.id);
    assert.equal(winRows.length, 1);

    await board.move(card.id, DONE, { wins });
    assert.equal(wins.list().filter((w) => w.source === "card" && w.ref === card.id).length, 1);
  } finally {
    board.close();
    wins.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("wins: dedupe by source+ref", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-win-dedupe-"));
  const wins = WinsStore.open(dir);
  try {
    const a = wins.add({ source: "manual", ref: "x", title: "First" });
    const b = wins.add({ source: "manual", ref: "x", title: "First" });
    assert.equal(a?.id, b?.id);
    assert.equal(wins.list().length, 1);
  } finally {
    wins.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("database: fresh Board and Wins stores create no retired integration tables", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-personal-db-"));
  const board = BoardStore.open(dir);
  const wins = WinsStore.open(dir);
  try {
    board.create({ title: "Keep my board" });
    wins.add({ source: "manual", ref: "keep", title: "Keep my wins" });
    const db = new DatabaseSync(join(dir, "rss.sqlite"));
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
      assert.deepEqual(tables.map((row) => row.name), ["card_events", "cards", "sqlite_sequence", "win_week_summaries", "wins"]);
    } finally {
      db.close();
    }
  } finally {
    board.close();
    wins.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("github wins poll without token does not throw", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-gh-win-"));
  const wins = WinsStore.open(dir);
  try {
    const n = await pollMergedPullRequestWins({
      username: "kellandamm",
      token: null,
      wins,
      sinceIso: new Date(Date.now() - 86400000).toISOString(),
    });
    assert.equal(n, 0);
    assert.equal(wins.list().length, 0);
  } finally {
    wins.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("daily briefing excludes Agent board sections even when board data exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-db-brief-"));
  const board = BoardStore.open(dir);
  const wins = WinsStore.open(dir);
  try {
    const hobie = await HobieQueueStore.open(dir);
    const cfg = loadConfig({ ADMIN_TOKEN: "t".repeat(32), ALLOW_INSECURE_NO_AUTH: "1", DATA_DIR: dir, TZ: "UTC" });
    const daily = await DailyBriefingService.open(dir, cfg.tz);

    const blocked = board.create({ title: "Need input", column: "Blocked on me" });
    assert.ok(blocked.id);
    const card = board.create({ title: "Move me" });
    await board.move(card.id, "Ready for Hobie", { hobieQueue: hobie, maxHobiePending: 20, wins });
    wins.add({ source: "manual", ref: "y-win", title: "Yesterday win", at: "2026-10-14T15:00:00.000Z" });

    const rec = await daily.generate({
      cfg,
      trigger: "manual",
      now: new Date("2026-10-15T12:00:00.000Z"),
      fetchFn: async () => Response.json({ current: { temperature_2m: 20 } }),
    });
    assert.equal("board" in rec.sources, false);
    assert.deepEqual(Object.keys(rec.sources).sort(), ["calendar", "topics", "weather"]);
  } finally {
    board.close();
    wins.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("board: claim reconciles Ready card before hobie_task_id is persisted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-board-race-"));
  const board = BoardStore.open(dir);
  const wins = WinsStore.open(dir);
  try {
    const hobie = await HobieQueueStore.open(dir);
    wireHobieBoardSync(hobie, board, wins);

    const card = board.create({ title: "Race reconcile", column: "Ready for Hobie" });
    const task = await hobie.enqueue({ clientId: "board", title: "Race reconcile", body: "", urgent: false }, 20);
    assert.equal(board.get(card.id)?.hobieTaskId, null);

    await hobie.claim(task.id);
    await new Promise((r) => setTimeout(r, 30));
    const after = board.get(card.id)!;
    assert.equal(after.hobieTaskId, task.id);
    assert.equal(after.column, WAITING);
  } finally {
    board.close();
    wins.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("schema upgrade: cards and wins tables on legacy rss DB", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-schema-board-"));
  let board: BoardStore | undefined;
  try {
    const dbPath = join(dir, "rss.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL)`);
    initSchema(db);
    db.close();

    board = BoardStore.open(dir);
    board.create({ title: "legacy ok" });
    assert.equal(board.list().length, 1);

    const db2 = new DatabaseSync(dbPath);
    const tables = db2
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('cards','wins','card_events')`)
      .all() as { name: string }[];
    assert.equal(tables.length, 3);
    initSchema(db2);
    db2.close();
  } finally {
    board?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
