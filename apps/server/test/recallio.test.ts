import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config";
import {
  parseRecallioSearchBody,
  recallioAccessHeaders,
  recallioConfigured,
  recallioSearchUrl,
  searchRecallio,
} from "../src/recallio/client";
import { BriefingService } from "../src/briefing/service";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { makeAuthenticator } from "../src/auth";
import { NewsPrefsStore } from "../src/feeds/news-prefs";
import { FeedsStore } from "../src/feeds/store";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";

const TOKEN = "t".repeat(32);

test("recallio: URL builder and CF Access outbound headers", () => {
  assert.equal(recallioSearchUrl("https://recall.example/"), "https://recall.example/api/search");
  const cfg = loadConfig({
    ADMIN_TOKEN: TOKEN,
    RECALLIO_URL: "https://recall.example",
    CF_ACCESS_CLIENT_ID: "cid",
    CF_ACCESS_CLIENT_SECRET: "sec",
  });
  assert.equal(recallioConfigured(cfg), true);
  assert.deepEqual(recallioAccessHeaders(cfg), {
    "cf-access-client-id": "cid",
    "cf-access-client-secret": "sec",
  });
  assert.deepEqual(recallioAccessHeaders(loadConfig({ ADMIN_TOKEN: TOKEN, RECALLIO_URL: "https://x", CF_ACCESS_CLIENT_ID: "a" })), {});
});

test("recallio: parseSearchBody accepts arrays and common wrappers", () => {
  const memories = [
    { id: "1", content: "likes dark mode", similarityScore: 0.9, tags: ["ui"] },
    { title: "Doc", snippet: "notes here", url: "https://a.example/x", score: 0.5 },
  ];
  assert.equal(parseRecallioSearchBody(JSON.stringify(memories), "application/json").length, 2);
  const wrapped = parseRecallioSearchBody(JSON.stringify({ results: memories }), "application/json");
  assert.equal(wrapped[0]!.title, "likes dark mode");
  assert.equal(wrapped[0]!.score, 0.9);
  assert.equal(wrapped[1]!.url, "https://a.example/x");
  assert.throws(() => parseRecallioSearchBody("not json", "text/plain"), /non-JSON/);
});

test("recallio: search degrades when unconfigured", async () => {
  const cfg = loadConfig({ ADMIN_TOKEN: TOKEN });
  const out = await searchRecallio(cfg, "test");
  assert.equal(out.configured, false);
  assert.match(out.error!, /RECALLIO_URL/);
});

test("recallio: API route returns graceful JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-recallio-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, RECALLIO_URL: "https://recall.example" });
  const settings = new SettingsStore(dir);
  await settings.load();
  const feeds = await FeedsStore.open(dir);
  const newsPrefs = await NewsPrefsStore.open(dir);
  const briefing = await BriefingService.open(dir, cfg.tz);
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const server = createApp({ cfg, auth: makeAuthenticator(cfg), settings, feeds, briefing, dailyBriefing, newsPrefs, notes });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const authz = { authorization: `Bearer ${TOKEN}` };
  try {
    const r = await fetch(`${base}/api/recallio/search?q=hi`, { headers: authz });
    assert.equal(r.status, 200);
    const j: any = await r.json();
    assert.equal(j.recallioEnabled, true);
    assert.equal(j.ok, false);
    assert.ok(j.error);
    assert.deepEqual(j.results, []);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
