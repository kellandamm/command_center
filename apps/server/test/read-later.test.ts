import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { DATABASE_FILE } from "../src/database";
import { migrateSavedArticles } from "../src/read-later/service";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const TOKEN = "t".repeat(32);
const admin = { authorization: `Bearer ${TOKEN}`, "x-ah": "1", "content-type": "application/json" };

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
  return { base, integration, close: async () => { await closeIntegrationServer(server, integration); await rm(dir, { recursive: true, force: true }); } };
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

test("read later: capture truncates oversized UTF-8 excerpts instead of rejecting", async () => {
  const h = await harness();
  try {
    const { token } = await (await fetch(`${h.base}/api/capture/access`, { method: "POST", headers: admin })).json() as { token: string };
    const oversized = "漢".repeat(8_000);
    assert.ok(Buffer.byteLength(oversized, "utf8") > 20_000);
    const response = await fetch(`${h.base}/api/capture`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/long", title: "Long", excerpt: oversized }),
    });
    assert.equal(response.status, 201);
    const body = await response.json() as { source: { excerpt: string } };
    assert.ok(Buffer.byteLength(body.source.excerpt, "utf8") <= 20_000);
    assert.doesNotMatch(body.source.excerpt, /\uFFFD/);
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
    for (const [path, target] of [
      ["/news", "/library?view=inbox"],
      ["/summaries", "/library?view=summarized"],
      ["/read-later", "/library?view=inbox"],
      ["/read-later?view=archive&q=example", "/library?view=archive&q=example"],
      ["/read-later/abc?from=saved", "/library/abc?from=saved"],
    ]) {
      const redirect = await fetch(`${h.base}${path}`, { headers: admin, redirect: "manual" });
      assert.equal(redirect.status, 302, path);
      assert.equal(redirect.headers.get("location"), target, path);
    }
    const zipRes = await fetch(`${h.base}/capture-extension.zip`, { headers: admin });
    const bytes = Buffer.from(await zipRes.arrayBuffer());
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    assert.ok(bytes.includes(Buffer.from("manifest.json")));
  } finally {
    await h.close();
  }
});

test("Agent: all sections share navigation; legacy context and queue actions are preserved", async () => {
  const h = await harness();
  try {
    for (const view of ["board", "queue", "wins", "assistant", "activity"]) {
      const response = await fetch(`${h.base}/agent?view=${view}`, { headers: admin });
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /href="\/agent" class="on"/);
      assert.ok(html.includes(`href="/agent?view=${view}" aria-current="page"`));
      assert.doesNotMatch(html, /href="\/(?:board|wins|assistant|activity)" class="on"/);
    }
    for (const [from, target] of [
      ["/board", "/agent?view=board"], ["/hobie", "/agent?view=queue"],
      ["/wins", "/agent?view=wins"], ["/activity", "/agent?view=activity"],
      ["/assistant?source=article", "/agent?source=article&view=assistant"],
    ]) {
      const response = await fetch(`${h.base}${from}`, { headers: admin, redirect: "manual" });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), target);
    }
    assert.equal((await fetch(`${h.base}/agent?view=invalid`, { headers: admin })).status, 400);
    const task = await h.integration.hobieQueue.enqueue({ title: "Review article", body: "Do the work", clientId: "test", urgent: false }, 10);
    const pending = await (await fetch(`${h.base}/api/hobie/queue?status=pending`, { headers: admin })).json();
    assert.equal(pending.tasks[0].id, task.id);
    const completed = await fetch(`${h.base}/api/hobie/queue/${task.id}/done`, { method: "POST", headers: admin, body: "{}" });
    assert.equal(completed.status, 200);
    assert.equal(h.integration.hobieQueue.list({ status: "done" }).length, 1);
  } finally {
    await h.close();
  }
});

test("read later: folders and tags persist on capture and organization without losing summaries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-folder-"));
  try {
    const store = await NotesStore.open(dir);
    const folder = await store.createSpace({ name: "Research" });
    const captured = await store.captureSource({ url: "https://example.com/folder", excerpt: "Article", spaceId: folder.id, tags: ["#Research", "research", "AI"] });
    assert.equal(captured.source.spaceId, folder.id);
    assert.deepEqual(captured.source.tags, ["research", "ai"]);
    await store.saveSourceSummary(captured.source.id, "Summary", "test", "Article");
    await store.updateSource(captured.source.id, { tags: ["updated"], spaceId: null });
    const reopened = await NotesStore.open(dir);
    const saved = reopened.getSource(captured.source.id)!;
    assert.equal(saved.summary, "Summary");
    assert.equal(saved.spaceId, null);
    assert.deepEqual(saved.tags, ["updated"]);
    await assert.rejects(store.captureSource({ url: "https://example.com/invalid", spaceId: "missing" }), /space/i);
    assert.equal(store.listSources().length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
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
