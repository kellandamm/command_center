import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config";
import { FeedsStore } from "../src/feeds/store";
import { NewsPrefsStore } from "../src/feeds/news-prefs";
import { SummaryDedupeError, SummaryRateLimitError, SummaryService } from "../src/feeds/summary-service";
import { RETENTION } from "../src/feeds/retention";

const TOKEN = "s".repeat(32);

test("summaries: dedupe prevents second summarize for same entry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sum-dedupe-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "1", LLM_BASE_URL: "https://llm.test", LLM_API_KEY: "k", LLM_MODEL: "m" });
  try {
    const feeds = await FeedsStore.open(dir);
    feeds.upsertFeedRow({ id: "f1", title: "F", xmlUrl: "https://example.com/f.xml", nextPollAt: new Date().toISOString() });
    const now = new Date("2026-10-14T12:00:00Z");
    const { ids } = feeds.ingestParsed("f1", [{ title: "Story", link: "https://example.com/a", guid: "a" }], now);
    const prefs = await NewsPrefsStore.open(dir);
    let calls = 0;
    const svc = new SummaryService(cfg, feeds, feeds.summaries, async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: "Short summary." } }] }), { status: 200 });
    });
    const first = await svc.summarizeEntry(ids[0]!, prefs.get(), now);
    assert.equal(first.created, true);
    assert.equal(calls, 1);
    await assert.rejects(() => svc.summarizeEntry(ids[0]!, prefs.get(), now), SummaryDedupeError);
    assert.equal(calls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("summaries: hourly rate cap", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sum-rate-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "1", LLM_BASE_URL: "https://llm.test", LLM_API_KEY: "k", LLM_MODEL: "m" });
  try {
    const feeds = await FeedsStore.open(dir);
    feeds.upsertFeedRow({ id: "f1", title: "F", xmlUrl: "https://example.com/f.xml", nextPollAt: new Date().toISOString() });
    const now = new Date("2026-10-14T12:00:00Z");
    const prefsStore = await NewsPrefsStore.open(dir);
    await prefsStore.update({ summarizeMaxPerHour: 1 });
    const prefs = prefsStore.get();
    assert.equal(prefs.summarizeMaxPerHour, 1);
    const svc = new SummaryService(cfg, feeds, feeds.summaries, async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "Ok." } }] }), { status: 200 }),
    );
    const first = feeds.ingestParsed("f1", [{ title: "T1", link: "https://example.com/1", guid: "1" }], now);
    await svc.summarizeEntry(first.ids[0]!, prefs, now);
    const second = feeds.ingestParsed("f1", [{ title: "T2", link: "https://example.com/2", guid: "2" }], now);
    await assert.rejects(() => svc.summarizeEntry(second.ids[0]!, prefs, now), SummaryRateLimitError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("summaries: survive entry retention prune", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sum-prune-"));
  try {
    const feeds = await FeedsStore.open(dir);
    feeds.upsertFeedRow({ id: "f1", title: "F", xmlUrl: "https://example.com/f.xml", nextPollAt: new Date().toISOString() });
    const now = new Date("2026-10-14T12:00:00Z");
    const entryId = feeds.ingestParsed("f1", [{ title: "Keep summary", link: "https://example.com/keep", guid: "k" }], now).ids[0]!;
    feeds.summaries.insert({
      entryId,
      url: "https://example.com/keep",
      title: "Keep summary",
      feedName: "F",
      folderName: null,
      summary: "Persisted text",
      model: "test",
      createdAt: now.toISOString(),
    });
    for (let i = 0; i < RETENTION.perFeed + 5; i++) {
      feeds.ingestParsed("f1", [{ title: `Filler ${i}`, link: `https://example.com/f${i}`, guid: String(i) }], new Date(now.getTime() + i * 1000));
    }
    feeds.runRetention(new Date("2026-12-01T12:00:00Z"));
    assert.equal(feeds.getEntry(entryId), undefined);
    const list = feeds.summaries.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.title, "Keep summary");
    assert.equal(list[0]!.entryExists, false);
    assert.equal(list[0]!.url, "https://example.com/keep");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
