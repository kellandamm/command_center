import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { feedIdsInScope, folderIdsForScope } from "../src/feed-scope";
import { FeedsStore } from "../src/feeds/store";
import { applySidebarTabsPatch, normalizeSidebarTabs, visibleNavTabs } from "../src/nav-tabs";
import { applySettings, DEFAULT_SETTINGS, SettingsStore } from "../src/settings";

test("nav: dashboard and settings tabs always visible", () => {
  const tabs = normalizeSidebarTabs(
    DEFAULT_SETTINGS.sidebarTabs.map((t) => (t.id === "news" ? { ...t, visible: false } : t)),
  );
  const visible = visibleNavTabs(tabs);
  assert.ok(visible.some((t) => t.href === "/"));
  assert.ok(visible.some((t) => t.href === "/settings"));
  assert.ok(!visible.some((t) => t.href === "/news"));
});

test("nav: existing sidebar settings gain the Bookmarks tab without changing saved preferences", () => {
  const tabs = normalizeSidebarTabs([{ id: "notes", label: "My notes", visible: false, order: 60 }]);
  assert.equal(tabs.find((tab) => tab.id === "notes")?.visible, false);
  assert.equal(tabs.find((tab) => tab.id === "notes")?.label, "My notes");
  assert.equal(tabs.find((tab) => tab.id === "bookmarks")?.visible, true);
  assert.ok(visibleNavTabs(tabs).some((tab) => tab.href === "/bookmarks"));
});

test("settings: legacy feeds field migrates out of persisted settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-settings-mig-"));
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(dir, "settings.json"),
      JSON.stringify({ feeds: "hn\nhttps://example.com/rss.xml", fetchIntervalMinutes: 15 }),
      "utf8",
    );
    const store = new SettingsStore(dir);
    await store.load();
    assert.equal(store.consumeLegacyFeeds()?.includes("hn"), true);
    assert.equal("feeds" in store.get(), false);
    assert.equal(store.get().fetchIntervalMinutes, 15);
    assert.equal(store.get().viewPreferences.calendar.weekStartsOn, "monday");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("feed scope: folder mode limits feed ids", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-feed-scope-"));
  const store = await FeedsStore.open(dir);
  try {
    const parent = store.createFolder("News").id;
    const child = store.createFolder("Tech", parent).id;
    store.upsertFeedRow({ id: "f1", title: "A", xmlUrl: "https://a.example/rss", folderId: parent, nextPollAt: new Date().toISOString() }, { setFolder: true });
    store.upsertFeedRow({ id: "f2", title: "B", xmlUrl: "https://b.example/rss", folderId: child, nextPollAt: new Date().toISOString() }, { setFolder: true });
    store.upsertFeedRow({ id: "f3", title: "C", xmlUrl: "https://c.example/rss", folderId: null, nextPollAt: new Date().toISOString() });
    const scope = { mode: "folders" as const, folderIds: [parent] };
    const ids = feedIdsInScope(store, scope)!;
    assert.deepEqual(new Set(ids), new Set(["f1", "f2"]));
    assert.equal(store.list({ feedIds: ids }).length, 0);
    store.ingestParsed("f2", [{ title: "x", link: "https://b.example/1", guid: "1" }], new Date());
    assert.equal(store.list({ feedIds: ids }).length, 1);
    assert.equal(folderIdsForScope(store, scope).includes(child), true);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("settings: applySettings validates feed scope and tabs rename", () => {
  const next = applySettings(DEFAULT_SETTINGS, {
    feedScope: { mode: "folders", folderIds: ["abc"] },
    sidebarTabs: applySidebarTabsPatch(DEFAULT_SETTINGS.sidebarTabs, [{ id: "news", label: "Reader" }]),
  });
  assert.equal(next.feedScope.mode, "folders");
  assert.equal(next.sidebarTabs.find((t) => t.id === "news")!.label, "Reader");
});

test("settings: view preferences customize page defaults and retain other defaults", () => {
  const next = applySettings(DEFAULT_SETTINGS, {
    viewPreferences: {
      density: "compact",
      calendar: { weekStartsOn: "sunday" },
      activity: { limit: 50 },
    },
  });
  assert.equal(next.viewPreferences.density, "compact");
  assert.equal(next.viewPreferences.calendar.weekStartsOn, "sunday");
  assert.equal(next.viewPreferences.activity.limit, 50);
  assert.equal(next.viewPreferences.news.layout, "dense");
  assert.equal(next.viewPreferences.dashboard.hobie, true);
  assert.throws(
    () => applySettings(DEFAULT_SETTINGS, { viewPreferences: { calendar: { weekStartsOn: "friday" } } }),
    /viewPreferences\.calendar\.weekStartsOn is invalid/,
  );
});
