import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applySidebarTabsPatch, normalizeSidebarTabs, visibleNavTabs } from "../src/nav-tabs";
import { applySettings, DEFAULT_SETTINGS, SettingsStore } from "../src/settings";

test("nav: dashboard and settings tabs always visible", () => {
  const tabs = normalizeSidebarTabs(
    DEFAULT_SETTINGS.sidebarTabs.map((t) => ({ ...t, visible: false })),
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

test("settings: retired integration settings are ignored while personal preferences survive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-settings-mig-"));
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(dir, "settings.json"),
      JSON.stringify({
        feeds: "hn\nhttps://example.com/rss.xml", fetchIntervalMinutes: 15, feedScope: { mode: "all" },
        briefingTime: "08:30",
        sidebarTabs: [{ id: "news", label: "Reader" }, { id: "ai-security" }, { id: "summaries" }],
        viewPreferences: { news: { layout: "card" }, aiSecurity: { showArchive: true }, summaries: { limit: 50 },
          dashboard: { news: false, calendar: false }, briefing: { news: true, ai: true, github: false } },
      }),
      "utf8",
    );
    const store = new SettingsStore(dir);
    await store.load();
    assert.equal("feeds" in store.get(), false);
    assert.equal("fetchIntervalMinutes" in store.get(), false);
    assert.equal("feedScope" in store.get(), false);
    assert.equal(store.get().briefingTime, "08:30");
    assert.equal(store.get().viewPreferences.dashboard.calendar, false);
    assert.equal(store.get().viewPreferences.briefing.github, false);
    const json = JSON.stringify(store.get());
    assert.doesNotMatch(json, /news|aiSecurity|ai-security|summaries|"ai"/);
    await store.update({ briefingTime: "09:00" });
    const { readFile } = await import("node:fs/promises");
    assert.doesNotMatch(await readFile(join(dir, "settings.json"), "utf8"), /feeds|feedScope|fetchInterval|news|aiSecurity|summaries/);
    assert.equal(store.get().viewPreferences.calendar.weekStartsOn, "monday");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("settings: applySettings retains sidebar renames", () => {
  const next = applySettings(DEFAULT_SETTINGS, {
    sidebarTabs: applySidebarTabsPatch(DEFAULT_SETTINGS.sidebarTabs, [{ id: "notes", label: "Writing" }]),
  });
  assert.equal(next.sidebarTabs.find((t) => t.id === "notes")!.label, "Writing");
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
  assert.equal(next.viewPreferences.notes.fontSize, "medium");
  assert.equal(next.viewPreferences.dashboard.hobie, true);
  assert.throws(
    () => applySettings(DEFAULT_SETTINGS, { viewPreferences: { calendar: { weekStartsOn: "friday" } } }),
    /viewPreferences\.calendar\.weekStartsOn is invalid/,
  );
});
