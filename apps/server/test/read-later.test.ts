import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { BriefingService } from "../src/briefing/service";
import { AiSecurityService } from "../src/ai-security/service";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { NewsPrefsStore } from "../src/feeds/news-prefs";
import { FeedsStore } from "../src/feeds/store";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const TOKEN = "t".repeat(32);
const admin = { authorization: `Bearer ${TOKEN}`, "x-ah": "1", "content-type": "application/json" };

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "cc-rl-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, TZ: "UTC" });
  const settings = new SettingsStore(dir);
  await settings.load();
  const feeds = await FeedsStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg, auth: makeAuthenticator(cfg), settings, feeds,
    briefing: await BriefingService.open(dir, cfg.tz),
    aiSecurity: await AiSecurityService.open(dir),
    dailyBriefing: await DailyBriefingService.open(dir, cfg.tz),
    newsPrefs: await NewsPrefsStore.open(dir),
    notes: await NotesStore.open(dir),
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: async () => { await closeIntegrationServer(server, feeds, integration); await rm(dir, { recursive: true, force: true }); } };
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
    const redirect = await fetch(`${h.base}/news`, { headers: admin, redirect: "manual" });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), "/read-later");
    const zipRes = await fetch(`${h.base}/capture-extension.zip`, { headers: admin });
    const bytes = Buffer.from(await zipRes.arrayBuffer());
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    assert.ok(bytes.includes(Buffer.from("manifest.json")));
  } finally {
    await h.close();
  }
});
