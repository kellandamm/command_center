import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { settingsPage } from "../src/ui/pages";
import { DEFAULT_SETTINGS } from "../src/settings";

test("settings: legacy hashes select Views section and matching sub-panel", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "settings.test") return route.abort();
      if (url.pathname === "/settings") return route.fulfill({ contentType: "text/html", body: settingsPage() });
      if (url.pathname === "/api/settings") {
        return route.fulfill({
          json: {
            settings: DEFAULT_SETTINGS,
            meta: { canManage: true },
            briefingProviders: { search: true, summarizer: true },
            ntfy: { enabled: false },
          },
        });
      }
      return route.continue();
    });
    for (const [hash, subId] of [
      ["views", "tab-views"],
      ["topics", "tab-topics"],
      ["schedule", "tab-schedule"],
      ["tabs", "tab-tabs"],
    ] as const) {
      await page.goto(`http://settings.test/settings#${hash}`);
      await page.waitForFunction(
        (id) => {
          const section = document.getElementById("settings-panel-views");
          const sub = document.getElementById(id);
          return (
            section?.classList.contains("on") &&
            !section?.hasAttribute("hidden") &&
            sub?.classList.contains("on") &&
            !sub?.hasAttribute("hidden")
          );
        },
        subId,
        { timeout: 10_000 },
      );
      const mainTab = await page.locator("#settings-tab-views").getAttribute("aria-selected");
      assert.equal(mainTab, "true", `hash #${hash} should select Views main tab`);
    }
  } finally {
    await browser.close();
  }
});

test("settings: main tablist keyboard navigation activates tabs and Tab enters panel", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "settings.test") return route.abort();
      if (url.pathname === "/settings") return route.fulfill({ contentType: "text/html", body: settingsPage() });
      if (url.pathname === "/api/settings") {
        return route.fulfill({
          json: {
            settings: DEFAULT_SETTINGS,
            meta: { canManage: true },
            briefingProviders: { search: true, summarizer: true },
            ntfy: { enabled: false },
          },
        });
      }
      return route.continue();
    });
    await page.goto("http://settings.test/settings");
    await page.waitForSelector("#settings-features-list", { timeout: 10_000 });
    await page.locator("#settings-tab-general").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#settings-tab-views").getAttribute("aria-selected"), "true");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "settings-tab-views");
    assert.equal(await page.evaluate(() => location.hash), "#views");
    await page.keyboard.press("End");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "settings-tab-views");
    await page.keyboard.press("Home");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "settings-tab-general");
    assert.equal(await page.evaluate(() => location.hash), "#general");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#settings-tab-connections").getAttribute("aria-selected"), "true");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => {
      const panel = document.getElementById("settings-panel-connections");
      const el = document.activeElement;
      return !!(panel && el && panel.contains(el) && el.classList.contains("settings-link-row"));
    });
  } finally {
    await browser.close();
  }
});

test("settings: Views sub-tablist responds to arrow keys", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "settings.test") return route.abort();
      if (url.pathname === "/settings") return route.fulfill({ contentType: "text/html", body: settingsPage() });
      if (url.pathname === "/api/settings") {
        return route.fulfill({
          json: {
            settings: DEFAULT_SETTINGS,
            meta: { canManage: true },
            briefingProviders: { search: true, summarizer: true },
            ntfy: { enabled: false },
          },
        });
      }
      return route.continue();
    });
    await page.goto("http://settings.test/settings#views");
    await page.locator("#settings-subtab-views").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#settings-subtab-topics").getAttribute("aria-selected"), "true");
    assert.equal(await page.evaluate(() => location.hash), "#topics");
    await page.keyboard.press("Home");
    assert.equal(await page.locator("#settings-subtab-views").getAttribute("aria-selected"), "true");
  } finally {
    await browser.close();
  }
});
