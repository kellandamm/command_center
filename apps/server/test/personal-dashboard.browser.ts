import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { dashboardPage, settingsPage } from "../src/ui/pages";
import { dailyBriefingPage } from "../src/ui/daily-briefing-page";
import { DEFAULT_SETTINGS } from "../src/settings";
import type { DailyBriefingRecord } from "../src/daily-briefing/types";

test("personal dashboard, settings and briefing work without retired integrations", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const settings = structuredClone(DEFAULT_SETTINGS);
    const briefing: DailyBriefingRecord = {
      day: "2026-10-14", generatedAt: "2026-10-14T12:00:00Z", trigger: "manual",
      sources: {
        todoist: { status: "ok", data: { overdue: [], today: [
          { id: "1", content: "Plan tomorrow", description: "", priority: 1, due: null, url: "" },
        ] } },
        calendar: { status: "ok", data: { events: [
          { uid: "meeting", summary: "Planning meeting", start: new Date("2026-10-14T13:00:00Z"), end: new Date("2026-10-14T14:00:00Z"), allDay: false, location: null },
        ] } },
        weather: { status: "error", message: "Weather temporarily unavailable" },
        github: { status: "empty", message: "Quiet day on GitHub" },
        board: { status: "empty", message: "No blockers or moves", data: { blocked: [], moved: [], wins: [] } },
      },
    };
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname !== "personal.test") return route.abort();
      const path = url.pathname;
      requests.push(path);
      const pages: Record<string, () => string> = { "/": dashboardPage, "/settings": settingsPage, "/briefing": dailyBriefingPage };
      if (pages[path]) return route.fulfill({ contentType: "text/html", body: pages[path]() });
      if (path === "/api/settings") {
        if (request.method() === "PUT") Object.assign(settings, request.postDataJSON());
        return route.fulfill({ json: { settings } });
      }
      if (path === "/api/daily-briefing/days") return route.fulfill({ json: { days: [briefing.day] } });
      if (path === "/api/daily-briefing/refresh") return route.fulfill({ json: { briefing } });
      if (path === "/api/daily-briefing") return route.fulfill({ json: { briefing } });
      if (path === "/api/hobie/board-summary") return route.fulfill({ json: { counts: {} } });
      if (path === "/api/calendar") return route.fulfill({ json: { events: [], feeds: [] } });
      if (path === "/api/activity/updates") return route.fulfill({ json: { updates: [] } });
      return route.fulfill({ status: 404, json: { error: `Unexpected route: ${path}` } });
    });
    await page.goto("http://personal.test/");
    await page.waitForFunction(() => document.querySelector("#dashboard-hobie-count")?.textContent !== "Loading…");
    assert.equal(await page.locator(".sidebar-nav").getByRole("link", { name: /News|Summaries|AI Security/ }).count(), 0);
    await page.goto("http://personal.test/settings");
    await page.waitForFunction(() => (document.querySelector("#briefingTime") as HTMLInputElement)?.value === "06:00");
    await page.locator('[data-tab="schedule"]').click();
    await page.locator("#briefingTime").fill("08:30");
    await Promise.all([
      page.waitForEvent("domcontentloaded"),
      page.getByRole("button", { name: "Save schedule", exact: true }).click(),
    ]);
    assert.equal(settings.briefingTime, "08:30");
    await page.reload();
    await page.waitForFunction(() => (document.querySelector("#briefingTime") as HTMLInputElement)?.value === "08:30");
    await page.goto("http://personal.test/briefing");
    await page.getByText("Plan tomorrow", { exact: true }).waitFor();
    assert.equal(await page.locator("#db-calendar-body").textContent().then((text) => text?.includes("Planning meeting")), true);
    assert.match(await page.locator("#db-weather-body").innerText(), /Weather temporarily unavailable/);
    assert.equal(await page.locator("#db-news, #db-ai").count(), 0);
    await page.locator("#db-refresh").click();
    await page.waitForFunction(() => !(document.querySelector("#db-refresh") as HTMLButtonElement).disabled);
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.locator("#db-board-blocked").isVisible(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    assert.deepEqual(errors, []);
    assert.equal(requests.some((path) => /^\/api\/(?:news|rss|feeds|summaries|ai-security|briefing\/generate)/.test(path)), false);
  } finally {
    await browser.close();
  }
});
