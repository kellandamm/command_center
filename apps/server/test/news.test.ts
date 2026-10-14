import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { filterTaggedItems } from "../src/feeds/news-routes";
import { NewsPrefsStore } from "../src/feeds/news-prefs";
import { tagsForItem } from "../src/feeds/topics";
import { BriefingService } from "../src/briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { FeedsStore } from "../src/feeds/store";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { openIntegrationStores } from "./helpers";

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
  const newsPrefs = await NewsPrefsStore.open(dir);
  const briefing = await BriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const { panelUpdates, hobieQueue } = await openIntegrationStores(dir);
  const server = createApp({ cfg, auth: makeAuthenticator(cfg), settings, feeds, briefing, newsPrefs, notes, panelUpdates, hobieQueue });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const authz = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-ah": "1" };
  try {
    const get = await fetch(`${base}/api/news`, { headers: authz });
    assert.equal(get.status, 200);
    const body: any = await get.json();
    assert.ok(Array.isArray(body.tags));
    const put = await fetch(`${base}/api/news/prefs`, {
      method: "PUT",
      headers: authz,
      body: JSON.stringify({ mutedTags: ["business"], focusTags: ["dev"] }),
    });
    assert.equal(put.status, 200);
    const stored = await NewsPrefsStore.open(dir);
    assert.deepEqual(stored.get().mutedTags, ["business"]);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
