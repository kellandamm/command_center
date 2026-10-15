import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { AiSecurityService } from "../src/ai-security/service";
import { ensureRoundupDir, listRoundupWeeks, roundupPath, writeRoundupFile } from "../src/ai-security/storage";
import { parsePublishPayload } from "../src/ai-security/validate";
import { BriefingService } from "../src/briefing/service";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { NewsPrefsStore } from "../src/feeds/news-prefs";
import { FeedsStore } from "../src/feeds/store";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { openIntegrationStores } from "./helpers";

const ADMIN = "a".repeat(32);
const PUBLISH = "p".repeat(32);

function sampleItems(n = 6) {
  return Array.from({ length: n }, (_, i) => ({
    title: `Item ${i + 1}`,
    summary: "A short summary of the security story. It fits in two sentences.",
    sourceUrl: `https://example.com/story-${i + 1}`,
    date: "2026-10-10",
  }));
}

test("ai security validation: item count and fields", () => {
  assert.throws(() => parsePublishPayload({ weekOf: "2026-10-06", items: sampleItems(5) }), /6–10/);
  assert.throws(() => parsePublishPayload({ weekOf: "2026-10-06", items: sampleItems(11) }), /6–10/);
  assert.throws(() => parsePublishPayload({ weekOf: "bad", items: sampleItems() }), /weekOf/);
  const badUrl = sampleItems();
  badUrl[0] = { ...badUrl[0]!, sourceUrl: "ftp://x.example/a" };
  assert.throws(() => parsePublishPayload({ weekOf: "2026-10-06", items: badUrl }), /http/);
  const ok = parsePublishPayload({ weekOf: "2026-10-06", items: sampleItems() });
  assert.equal(ok.items.length, 6);
});

test("ai security storage: weeks list newest first", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-ais-"));
  const storeDir = join(dir, "ai-security");
  try {
    const rec = (weekOf: string) => ({
      weekOf,
      publishedAt: `${weekOf}T12:00:00.000Z`,
      items: sampleItems(),
    });
    await ensureRoundupDir(storeDir);
    await writeRoundupFile(roundupPath(storeDir, "2026-10-06"), rec("2026-10-06"));
    await writeRoundupFile(roundupPath(storeDir, "2026-09-29"), rec("2026-09-29"));
    const weeks = await listRoundupWeeks(storeDir);
    assert.deepEqual(weeks, ["2026-10-06", "2026-09-29"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ai security API: publish, list, and reject invalid payload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-ais-api-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: ADMIN, AI_SECURITY_TOKEN: PUBLISH });
  const settings = new SettingsStore(dir);
  await settings.load();
  const feeds = await FeedsStore.open(dir);
  const newsPrefs = await NewsPrefsStore.open(dir);
  const briefing = await BriefingService.open(dir, cfg.tz);
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const aiSecurity = await AiSecurityService.open(dir);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg),
    settings,
    feeds,
    briefing,
    aiSecurity,
    dailyBriefing,
    newsPrefs,
    notes,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const authz = { authorization: `Bearer ${ADMIN}`, "content-type": "application/json", "x-ah": "1" };
  const publishz = { authorization: `Bearer ${PUBLISH}`, "content-type": "application/json", "x-ah": "1" };

  try {
    const empty = await fetch(`${base}/api/ai-security/roundups`, { headers: authz });
    assert.deepEqual((await empty.json()).weeks, []);

    const bad = await fetch(`${base}/api/ai-security/roundups`, {
      method: "POST",
      headers: authz,
      body: JSON.stringify({ weekOf: "2026-10-06", items: sampleItems(3) }),
    });
    assert.equal(bad.status, 400);

    const pub = await fetch(`${base}/api/ai-security/roundups`, {
      method: "POST",
      headers: publishz,
      body: JSON.stringify({ weekOf: "2026-10-06", items: sampleItems() }),
    });
    assert.equal(pub.status, 201);
    const body: any = await pub.json();
    assert.equal(body.roundup.weekOf, "2026-10-06");
    assert.equal(body.roundup.items.length, 6);

    const denied = await fetch(`${base}/api/ai-security/roundups`, {
      method: "POST",
      headers: { authorization: `Bearer ${"x".repeat(32)}`, "content-type": "application/json", "x-ah": "1" },
      body: JSON.stringify({ weekOf: "2026-09-29", items: sampleItems() }),
    });
    assert.equal(denied.status, 401);

    const list = await fetch(`${base}/api/ai-security/roundups`, { headers: authz });
    const listed: any = await list.json();
    assert.deepEqual(listed.weeks, ["2026-10-06"]);
    assert.equal(listed.latest.weekOf, "2026-10-06");
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
