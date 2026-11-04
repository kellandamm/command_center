import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { dailyBriefingPage } from "../src/ui/daily-briefing-page";

test("team update tab renders agent cards from API", { timeout: 60_000 }, async (t) => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined, timeout: 15_000 });
  t.diagnostic("Browser launched");
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "briefing.test") return route.abort();
      if (url.pathname === "/briefing") {
        return route.fulfill({ contentType: "text/html", body: dailyBriefingPage() });
      }
      if (url.pathname === "/api/daily-briefing/days") {
        return route.fulfill({ json: { days: ["2026-11-04"] } });
      }
      if (url.pathname === "/api/daily-briefing") {
        return route.fulfill({ json: { day: "2026-11-04", briefing: null } });
      }
      if (url.pathname === "/api/team-update") {
        return route.fulfill({
          json: {
            day: "2026-11-04",
            days: ["2026-11-04"],
            update: {
              date: "2026-11-04",
              importedAt: "2026-11-04T18:00:00.000Z",
              agents: [
                {
                  name: "Cloud Agent",
                  did: ["Opened draft PR"],
                  waitingOnKellan: ["Merge when ready"],
                  updatedAt: "2026-11-04T17:30:00.000Z",
                },
              ],
            },
          },
        });
      }
      if (url.pathname === "/api/settings") {
        return route.fulfill({ json: { settings: {}, runtime: { timezone: "UTC" } } });
      }
      return route.fulfill({ status: 404, body: "not found" });
    });
    await page.goto("http://briefing.test/briefing");
    await page.locator("#db-mode-team-update").click();
    await page.getByRole("heading", { name: "Cloud Agent" }).waitFor();
    assert.match(await page.locator("#db-team-update-body").innerText(), /Opened draft PR/);
    assert.match(await page.locator("#db-team-update-body").innerText(), /Merge when ready/);
  } finally {
    await browser.close();
  }
});
