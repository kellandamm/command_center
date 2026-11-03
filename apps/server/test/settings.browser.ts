import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";
import { settingsPage } from "../src/ui/pages";
import { applySettings, DEFAULT_SETTINGS } from "../src/settings";
import { visibleNavTabs } from "../src/nav-tabs";
import { connectionsPage } from "../src/ui/connections-page";

async function fixture(page: Page, readOnly = false) {
  let settings = structuredClone(DEFAULT_SETTINGS), revision = 1, conflict = false, writes = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== "settings.test") return route.abort();
    if (url.pathname === "/settings") return route.fulfill({ contentType: "text/html", body: settingsPage(visibleNavTabs(settings.sidebarTabs)) });
    if (url.pathname === "/settings/connections") return route.fulfill({ contentType: "text/html", body: connectionsPage() });
    if (url.pathname === "/api/connections") return route.fulfill({ json: { connections: [], writable: false } });
    if (url.pathname === "/api/settings") {
      if (request.method() === "PUT") {
        writes++;
        if (conflict || request.postDataJSON().expectedRevision !== String(revision)) {
          conflict = false; revision++; settings.briefingTime = "10:00";
          return route.fulfill({ status: 409, json: { error: "Settings changed elsewhere. Review the current settings before saving again." } });
        }
        settings = applySettings(settings, request.postDataJSON()); revision++;
      }
      return route.fulfill({ json: { settings, revision: String(revision), meta: { canManage: !readOnly }, briefingProviders: { search: true, summarizer: true }, ntfy: { enabled: false } } });
    }
    return route.fulfill({ status: 404 });
  });
  return { errors, get settings() { return settings; }, get writes() { return writes; }, conflict: () => { conflict = true; } };
}

test("settings: legacy links map to flat categories; search and history work", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage(); const state = await fixture(page);
    for (const [hash, category] of [["views", "appearance"], ["tabs", "appearance"], ["topics", "briefing"], ["schedule", "briefing"], ["overview", "general"]]) {
      await page.goto("http://settings.test/settings#" + hash);
      await page.waitForFunction(() => !(document.getElementById("settings-editor") as HTMLFieldSetElement).disabled);
      assert.equal(await page.locator('[data-settings-panel="' + category + '"]').isVisible(), true);
      assert.equal(await page.locator(".settings-category-links [aria-current]").getAttribute("data-settings-category"), category);
    }
    assert.equal(await page.locator('[role="tablist"]').count(), 0);
    await page.locator('.settings-category-links [data-settings-category="briefing"]').click();
    await page.goBack(); assert.equal(await page.locator("#settings-panel-general").isVisible(), true);
    await page.goForward(); assert.equal(await page.locator("#settings-panel-briefing").isVisible(), true);
    await page.locator("#settings-search").fill("model");
    assert.equal(await page.locator("#settings-search-results").getByRole("link", { name: "Connections" }).count(), 1);
    await page.locator("#settings-search").fill("nothing matches");
    assert.equal(await page.locator("#settings-search-empty").isVisible(), true);
    await page.goto("http://settings.test/settings#connections");
    await page.waitForURL("http://settings.test/settings/connections");
    assert.equal(await page.locator("#settings-category-title").innerText(), "Connections");
    assert.deepEqual(state.errors, []);
  } finally { await browser.close(); }
});

test("settings: section saves preserve unrelated drafts, Cancel restores, navigation asks Stay or Discard", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage(); const state = await fixture(page);
    await page.goto("http://settings.test/settings#appearance");
    await page.waitForFunction(() => !(document.getElementById("settings-editor") as HTMLFieldSetElement).disabled);
    assert.equal(await page.locator("#actions-views").isHidden(), true);
    const notesLabel = page.getByRole("textbox", { name: "Label for notes", exact: true });
    await notesLabel.fill("Writing room");
    await page.locator("#pref-density").selectOption("compact");
    await page.locator("#views-save").click();
    await page.locator("#saved-views").getByText("Saved.", { exact: true }).waitFor();
    assert.equal(state.settings.viewPreferences.density, "compact");
    assert.equal(await notesLabel.inputValue(), "Writing room");
    assert.equal(await page.locator("#tabs-save").isEnabled(), true);
    assert.equal(state.settings.sidebarTabs.find((tab) => tab.id === "notes")?.label, "Notes");
    await page.locator('[data-cancel="tabs"]').click();
    assert.equal(await notesLabel.inputValue(), "Notes");
    await notesLabel.fill("Writing room");
    await page.locator("#tabs-save").click();
    await page.locator("#saved-tabs").getByText("Saved.", { exact: true }).waitFor();
    assert.equal(await page.locator('.sidebar-content a[href="/notes"] .sidebar-label').innerText(), "Writing room");
    assert.equal(await page.locator("#settings-panel-appearance").isVisible(), true);
    await page.locator("#pref-notes-size").selectOption("large");
    await page.locator('.settings-category-links [data-settings-category="briefing"]').click();
    await page.locator("#settings-stay").click();
    assert.equal(await page.locator("#settings-panel-appearance").isVisible(), true);
    assert.equal(await page.locator("#pref-notes-size").inputValue(), "large");
    await page.locator('.settings-category-links [data-settings-category="briefing"]').click();
    await page.locator("#settings-discard").click();
    await page.waitForFunction(() => location.hash === "#briefing");
    assert.equal(await page.locator("#pref-notes-size").inputValue(), "medium");
    assert.equal(state.writes, 2); assert.deepEqual(state.errors, []);
  } finally { await browser.close(); }
});

test("settings: conflicts retain drafts until explicit version review, then save", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage(); const state = await fixture(page);
    await page.goto("http://settings.test/settings#briefing");
    await page.waitForFunction(() => !(document.getElementById("settings-editor") as HTMLFieldSetElement).disabled);
    await page.locator("#briefingTime").fill("08:30"); state.conflict();
    await page.locator("#schedule-save").click();
    await page.locator("#settings-conflict").waitFor();
    assert.equal(await page.locator("#briefingTime").inputValue(), "08:30");
    assert.equal(await page.locator("#schedule-save").isDisabled(), true);
    assert.match(await page.locator("#settings-conflict-current").innerText(), /10:00/);
    await page.locator("#settings-conflict-keep").click();
    await page.locator("#schedule-save").click();
    await page.locator("#saved-schedule").getByText("Saved.", { exact: true }).waitFor();
    assert.equal(state.settings.briefingTime, "08:30"); assert.deepEqual(state.errors, []);
  } finally { await browser.close(); }
});

test("settings: loaded view-only preferences remain disabled and categories are keyboard accessible", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage(); const state = await fixture(page, true);
    await page.goto("http://settings.test/settings#views");
    await page.waitForFunction(() => !(document.getElementById("settings-editor") as HTMLFieldSetElement).disabled);
    for (const selector of ["#views-save", "#tabs-save", "#schedule-save", "#topics-save", "#pref-density"]) assert.equal(await page.locator(selector).isDisabled(), true, selector);
    assert.equal(await page.locator("#settings-manage-hint").isVisible(), true);
    await page.locator('.settings-category-links [data-settings-category="briefing"]').focus(); await page.keyboard.press("Enter");
    assert.equal(await page.locator("#settings-panel-briefing").isVisible(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#settings-category").selectOption("/settings#advanced");
    await page.waitForFunction(() => location.hash === "#advanced");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(state.errors, []);
  } finally { await browser.close(); }
});
