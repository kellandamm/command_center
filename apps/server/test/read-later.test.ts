import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { IncomingMessage } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { bearerToken, makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { DATABASE_FILE } from "../src/database";
import { migrateSavedArticles } from "../src/read-later/service";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const TOKEN = "t".repeat(32);
const admin = { authorization: `Bearer ${TOKEN}`, "x-ah": "1", "content-type": "application/json" };

test("read later: bearer tokens accept HTTP whitespace but reject whitespace inside credentials", () => {
  const parse = (authorization?: string) => bearerToken({ headers: { authorization } } as IncomingMessage);
  assert.equal(parse(`bEaReR \t${TOKEN}`), TOKEN);
  assert.equal(parse(), undefined);
  assert.equal(parse("Basic credentials"), undefined);
  assert.equal(parse(["Bearer", TOKEN, TOKEN].join(" ")), undefined);
  assert.equal(parse(`Bearer${"\t".repeat(10_000)}`), undefined);
});

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "cc-rl-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, TZ: "UTC" });
  const settings = new SettingsStore(dir);
  await settings.load();
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg, auth: makeAuthenticator(cfg), settings,
    dailyBriefing: await DailyBriefingService.open(dir, cfg.tz),
    notes: await NotesStore.open(dir),
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: async () => { await closeIntegrationServer(server, integration); await rm(dir, { recursive: true, force: true }); } };
}

test("read later: scoped capture token saves pages and nothing else", async () => {
  const h = await harness();
  try {
    const unauth = await fetch(`${h.base}/api/capture`, { method: "POST", headers: { authorization: "Bearer nope", "content-type": "application/json" }, body: "{}" });
    assert.equal(unauth.status, 401);

    const { token } = await (await fetch(`${h.base}/api/capture/access`, { method: "POST", headers: admin })).json() as { token: string };
    const capture = (body: unknown, auth = token) => fetch(`${h.base}/api/capture`, {
      method: "POST", headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" }, body: JSON.stringify(body),
    });

    const saved = await capture({ url: "https://example.com/a#frag", title: "Article", excerpt: "Body text" });
    assert.equal(saved.status, 201);
    assert.equal((await capture({ url: "https://example.com/a", title: "Article" })).status, 200);
    assert.equal((await capture({ url: "https://user:pw@example.com/b", title: "Bad" })).status, 400);

    const list = await (await fetch(`${h.base}/api/read-later`, { headers: admin })).json() as { sources: unknown[]; inboxCount: number };
    assert.equal(list.sources.length, 1);
    assert.equal(list.inboxCount, 1);

    const library = await fetch(`${h.base}/api/read-later`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(library.status, 401);

    await fetch(`${h.base}/api/capture/access`, { method: "DELETE", headers: admin });
    assert.equal((await capture({ url: "https://example.com/c", title: "C" })).status, 401);
  } finally {
    await h.close();
  }
});

test("read later: pages, redirects, and extension download", async () => {
  const h = await harness();
  try {
    for (const path of ["/read-later", "/library", "/spaces", "/assistant", "/settings/capture", "/notes/connections"]) {
      assert.equal((await fetch(`${h.base}${path}`, { headers: admin })).status, 200, path);
    }
    for (const [path, target] of [["/news", "/read-later"], ["/summaries", "/library"]]) {
      const redirect = await fetch(`${h.base}${path}`, { headers: admin, redirect: "manual" });
      assert.equal(redirect.status, 302);
      assert.equal(redirect.headers.get("location"), target);
    }
    const zipRes = await fetch(`${h.base}/capture-extension.zip`, { headers: admin });
    const bytes = Buffer.from(await zipRes.arrayBuffer());
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    assert.ok(bytes.includes(Buffer.from("manifest.json")));
  } finally {
    await h.close();
  }
});

test("read later: migration skips missing databases and databases without legacy tables", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-rl-migration-"));
  try {
    const notes = await NotesStore.open(dir);
    const path = join(dir, DATABASE_FILE);
    assert.equal(await migrateSavedArticles(dir, notes), 0);
    await assert.rejects(readFile(path), { code: "ENOENT" });
    const db = new DatabaseSync(path);
    try {
      db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY)");
    } finally {
      db.close();
    }
    const original = await readFile(path);
    assert.equal(await migrateSavedArticles(dir, notes), 0);
    assert.deepEqual(await readFile(path), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("read later: migration preserves starred articles and summaries without modifying legacy data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-rl-migration-"));
  try {
    const path = join(dir, DATABASE_FILE);
    const db = new DatabaseSync(path);
    const at = "2026-10-14T12:00:00.000Z";
    try {
      db.exec(`
        CREATE TABLE entries (id TEXT PRIMARY KEY, title TEXT, link TEXT, snippet TEXT,
          content_html TEXT, first_seen_at TEXT, starred INTEGER);
        CREATE TABLE summaries (id TEXT PRIMARY KEY, entry_id TEXT, title TEXT, url TEXT,
          summary TEXT, model TEXT, created_at TEXT);
      `);
      const insertEntry = db.prepare("INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?)");
      insertEntry.run("star", "Saved article", "https://example.com/star", "Snippet", "<p>Captured text</p>", at, 1);
      insertEntry.run("other", "Other article", "https://example.com/other", "Not saved", null, at, 0);
      const insertSummary = db.prepare("INSERT INTO summaries VALUES (?, ?, ?, ?, ?, ?, ?)");
      insertSummary.run("first", "star", "Saved article", "https://example.com/star", "Saved summary", "model", at);
      insertSummary.run("second", "other", "Other article", "https://example.com/other", "Archived summary", "model", at);
      insertSummary.run("third", null, "Standalone", null, "Standalone summary", "model", at);
    } finally {
      db.close();
    }
    const original = await readFile(path);
    const notes = await NotesStore.open(dir);
    assert.equal(await migrateSavedArticles(dir, notes), 3);
    const saved = notes.listSources().find((source) => source.originKey === "rss:star")!;
    assert.equal(saved.summary, "Saved summary");
    assert.equal(saved.summaryModel, "model");
    assert.equal(saved.summarizedAt, at);
    assert.equal(saved.archivedAt, null);
    assert.match(saved.excerpt, /Captured text/);
    assert.doesNotMatch(saved.excerpt, /<p>/);
    assert.equal(notes.listSources().find((source) => source.originKey === "summary:second")?.archivedAt, at);
    assert.equal(notes.listSources().find((source) => source.originKey === "summary:third")?.summary, "Standalone summary");
    assert.equal(await migrateSavedArticles(dir, await NotesStore.open(dir)), 0);
    assert.deepEqual(await readFile(path), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
