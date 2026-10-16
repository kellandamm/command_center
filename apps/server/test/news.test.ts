import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { AiSecurityService } from "../src/ai-security/service";
import { filterTaggedItems } from "../src/feeds/news-routes";
import { NewsPrefsStore } from "../src/feeds/news-prefs";
import { tagsForItem } from "../src/feeds/topics";
import { BriefingService } from "../src/briefing/service";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { FeedsStore, itemId } from "../src/feeds/store";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const TOKEN = "n".repeat(32);

test("topics: keyword and feed rules assign tags", () => {
  const security = tagsForItem({
    id: "1",
    feedId: "hn",
    title: "Critical CVE in OpenSSL",
    firstSeenAt: "2026-01-01T00:00:00Z",
    read: false,
  });
  assert.ok(security.includes("security"));
  const ai = tagsForItem({
    id: "2",
    feedId: "https://openai.com/blog/rss",
    title: "New model release",
    firstSeenAt: "2026-01-01T00:00:00Z",
    read: false,
  });
  assert.ok(ai.includes("ai"));
});

test("news filter: mute and focus tags", () => {
  const items = [
    { id: "a", feedId: "hn", title: "A", firstSeenAt: "", read: false, tags: ["security", "community"] },
    { id: "b", feedId: "hn", title: "B", firstSeenAt: "", read: false, tags: ["dev"] },
  ];
  assert.equal(filterTaggedItems(items, { mutedTags: ["security"], focusTags: [] }).length, 2);
  assert.equal(filterTaggedItems(items, { mutedTags: ["security", "community"], focusTags: [] }).length, 1);
  assert.deepEqual(filterTaggedItems(items, { mutedTags: [], focusTags: ["dev"] }).map((i) => i.id), ["b"]);
});

test("news API: prefs persist under data dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-news-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "1" });
  const settings = new SettingsStore(dir);
  await settings.load();
  const feeds = await FeedsStore.open(dir);
  const entryId = itemId("hn", "https://example.com/security-story", "Critical CVE disclosure");
  feeds.ingest("hn", [{ title: "Critical CVE disclosure", link: "https://example.com/security-story" }], new Date());
  const newsPrefs = await NewsPrefsStore.open(dir);
  const briefing = await BriefingService.open(dir, cfg.tz);
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const aiSecurity = await AiSecurityService.open(dir);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({ cfg, auth: makeAuthenticator(cfg), settings, feeds, briefing, aiSecurity, dailyBriefing, newsPrefs, notes, ...integration });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const authz = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-ah": "1" };
  try {
    const get = await fetch(`${base}/api/news`, { headers: authz });
    assert.equal(get.status, 200);
    const body: any = await get.json();
    assert.ok(Array.isArray(body.tags));
    const jsonHeaders = { ...authz, "content-type": "application/json" };
    const star = await fetch(`${base}/api/rss/star`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ id: entryId, starred: true }),
    });
    assert.equal(star.status, 200);
    const saved = await fetch(`${base}/api/news?starred=1`, { headers: authz });
    assert.deepEqual((await saved.json() as any).items.map((item: any) => item.id), [entryId]);
    const markRead = await fetch(`${base}/api/rss/read`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ ids: [entryId], read: true }),
    });
    assert.equal(markRead.status, 200);
    const savedRead = await fetch(`${base}/api/news?starred=1`, { headers: authz });
    assert.deepEqual((await savedRead.json() as any).items.map((item: any) => item.id), [entryId]);
    const savedUnread = await fetch(`${base}/api/news?starred=1&unread=1`, { headers: authz });
    assert.deepEqual((await savedUnread.json() as any).items, []);
    const markUnread = await fetch(`${base}/api/rss/read`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ ids: [entryId], read: false }),
    });
    assert.equal(markUnread.status, 200);
    const savedUnreadAgain = await fetch(`${base}/api/news?starred=1&unread=1`, { headers: authz });
    assert.deepEqual((await savedUnreadAgain.json() as any).items.map((item: any) => item.id), [entryId]);
    const unstar = await fetch(`${base}/api/rss/star`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ id: entryId, starred: false }),
    });
    assert.equal(unstar.status, 200);
    const savedAgain = await fetch(`${base}/api/news?starred=1`, { headers: authz });
    assert.deepEqual((await savedAgain.json() as any).items, []);
    const put = await fetch(`${base}/api/news/prefs`, {
      method: "PUT",
      headers: authz,
      body: JSON.stringify({ mutedTags: ["business"], focusTags: ["dev"] }),
    });
    assert.equal(put.status, 200);
    const stored = await NewsPrefsStore.open(dir);
    assert.deepEqual(stored.get().mutedTags, ["business"]);
  } finally {
    await closeIntegrationServer(server, feeds, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
