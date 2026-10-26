import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { dashboardPage, settingsPage } from "../src/ui/pages";
import { dailyBriefingPage } from "../src/ui/daily-briefing-page";
import { DEFAULT_SETTINGS } from "../src/settings";
import type { DailyBriefingRecord } from "../src/daily-briefing/types";

test("personal dashboard, settings and briefing work without retired integrations", { timeout: 90_000 }, async (t) => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined, timeout: 15_000 });
  t.diagnostic("Browser launched");
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    const requests: string[] = [];
    const unexpectedRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const settings = structuredClone(DEFAULT_SETTINGS);
    const briefing: DailyBriefingRecord = {
      day: "2026-10-14", generatedAt: "2026-10-14T12:00:00Z", trigger: "manual",
      sources: {
        calendar: { status: "ok", data: { events: [
          { uid: "meeting", summary: "Planning meeting", start: new Date("2026-10-14T13:00:00Z"), end: new Date("2026-10-14T14:00:00Z"), allDay: false, location: null },
        ] } },
        weather: { status: "error", message: "Weather temporarily unavailable" },
        topics: { status: "error", data: { items: [
          { keyword: "Microsoft Fabric", status: "ok", summary: "A new feature is available [1].", articles: [
            { title: "Feature announcement", url: "https://example.com/story", excerpt: "New feature" },
          ] },
          { keyword: "A topic with no results", status: "empty", message: "No matching results from the past 24 hours.", articles: [] },
          { keyword: "<script>untrusted</script>", status: "error", message: "Brave Search returned HTTP 429.", articles: [] },
        ] } },
      },
    };
    let failTopicsSave = false;
    let failRefresh = false;
    let refreshPolls = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname !== "personal.test") return route.abort();
      const path = url.pathname;
      requests.push(path);
      const pages: Record<string, () => string> = { "/": dashboardPage, "/settings": settingsPage, "/briefing": dailyBriefingPage };
      if (pages[path]) return route.fulfill({ contentType: "text/html", body: pages[path]() });
      if (path === "/api/settings") {
        if (request.method() === "PUT" && failTopicsSave) return route.fulfill({ status: 400, json: { error: "Could not save topics" } });
        if (request.method() === "PUT") Object.assign(settings, request.postDataJSON());
        return route.fulfill({ json: { settings, briefingProviders: { search: false, summarizer: false } } });
      }
      if (path === "/api/daily-briefing/days") return route.fulfill({ json: { days: [briefing.day] } });
      if (path === "/api/daily-briefing/refresh") {
        if (request.method() === "POST") {
          refreshPolls = 0;
          return route.fulfill({ status: 202, json: { day: briefing.day, status: "generating" } });
        }
        return route.fulfill({ json: {
          day: briefing.day, status: failRefresh ? "error" : refreshPolls++ === 0 ? "generating" : "idle",
          message: failRefresh ? "Could not save this edition." : undefined,
        } });
      }
      if (path === "/api/daily-briefing") return route.fulfill({ json: url.searchParams.get("day") ? { day: briefing.day, briefing } : { day: "2026-10-21", briefing: null } });
      if (path === "/api/read-later") return route.fulfill({ json: { items: [] } });
      if (path === "/api/hobie/board-summary") return route.fulfill({ json: { counts: {} } });
      if (path === "/api/calendar") return route.fulfill({ json: { events: [], feeds: [] } });
      if (path === "/api/activity/updates") return route.fulfill({ json: { updates: [] } });
      const dashboardFixtures: Record<string, unknown> = {
        "/api/dashboard/focus/tasks": { configured: true, tasks: [], timezone: "UTC" },
        "/api/dashboard-layout": { layout: {} },
        "/api/voice-captures": { captures: [], count: 0, timezone: "UTC" },
        "/api/weather": { ok: false, error: "Weather temporarily unavailable" },
        "/api/notes": { content: "" },
        "/api/host-health": { host: {}, docker: { available: false, reason: "Docker not configured", containers: [] }, readOnly: true },
        "/api/recallio/search": { configured: false, recallioEnabled: false, results: [] },
        "/api/dashboard/tasks": { filter: "all", today: briefing.day, columns: ["Backlog"], tasks: [] },
        "/api/dashboard/attention": { sections: [], pinned: [], hidden: [] },
        "/api/dashboard/heatmap": { days: [] },
        "/api/launchpad": { links: [], owner: false },
      };
      if (Object.hasOwn(dashboardFixtures, path)) return route.fulfill({ json: dashboardFixtures[path] });
      if (path === "/icon-192.png") return route.fulfill({ status: 204 });
      unexpectedRequests.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 404, json: { error: `Unexpected route: ${path}` } });
    });
    await page.goto("http://personal.test/");
    t.diagnostic("Dashboard opened");
    await page.waitForSelector("#panel-tasks", { timeout: 15_000 });
    assert.equal(await page.locator(".sidebar-nav").getByRole("link", { name: /News|Summaries|AI Security/ }).count(), 0);
    await page.goto("http://personal.test/settings");
    t.diagnostic("Settings opened");
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
    await page.goto("http://personal.test/settings#topics");
    t.diagnostic("Topic settings opened");
    await page.waitForFunction(() => !(document.querySelector("#topics-save") as HTMLButtonElement)?.disabled);
    assert.equal(await page.locator("#tab-topics").isVisible(), true);
    assert.match(await page.locator("#topics-providers").innerText(), /BRAVE_SEARCH_API_KEY/);
    await page.locator("#briefingTopics").fill("Microsoft Fabric\nAI security");
    await page.locator("#topics-save").click();
    await page.getByText("Topics saved.", { exact: true }).waitFor();
    assert.deepEqual(settings.briefingTopics, ["Microsoft Fabric", "AI security"]);
    await page.reload();
    await page.waitForFunction(() => (document.querySelector("#briefingTopics") as HTMLTextAreaElement)?.value === "Microsoft Fabric\nAI security");
    failTopicsSave = true;
    await page.locator("#briefingTopics").fill("Keep my draft");
    await page.locator("#topics-save").click();
    await page.locator("#saved-topics").getByText("Could not save topics", { exact: true }).waitFor();
    assert.equal(await page.locator("#briefingTopics").inputValue(), "Keep my draft");
    failTopicsSave = false;
    await page.locator("#briefingTopics").fill(Array(11).fill("Topic").join("\n"));
    await page.locator("#topics-save").click();
    assert.match(await page.locator("#saved-topics").innerText(), /up to 10 topics/);
    await page.locator("#briefingTopics").fill("Microsoft Fabric\nAI security");
    await page.locator("#topics-save").click();
    await page.getByText("Topics saved.", { exact: true }).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (process.env.SCREENSHOT_DIR) {
        await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, `briefing-settings-${width}.png`), fullPage: true });
      }
    }
    await page.locator("#briefingTopics").fill("");
    await page.locator("#topics-save").click();
    await page.getByText("Topics saved.", { exact: true }).waitFor();
    assert.deepEqual(settings.briefingTopics, []);
    await page.goto("http://personal.test/briefing");
    t.diagnostic("Briefing opened");
    await page.getByText("No edition for this day yet. Refresh edition to generate today's briefing.", { exact: true }).waitFor();
    assert.equal(await page.locator("#db-day").inputValue(), "2026-10-21");
    await page.locator("#db-day").selectOption(briefing.day);
    await page.getByText("A new feature is available [1].", { exact: true }).waitFor();
    t.diagnostic("Archive edition loaded");
    assert.equal(await page.locator("#db-calendar-body").textContent().then((text) => text?.includes("Planning meeting")), true);
    assert.match(await page.locator("#db-weather-body").innerText(), /Weather temporarily unavailable/);
    assert.equal(await page.locator("#db-todoist, #db-github, [id^=db-board]").count(), 0);
    assert.equal(await page.getByRole("link", { name: "Feature announcement" }).getAttribute("href"), "https://example.com/story");
    assert.match(await page.locator("#db-topics-body").innerText(), /No matching results|HTTP 429/);
    assert.equal(await page.locator("#db-topics-body script").count(), 0);
    await page.locator("#db-refresh").click();
    await page.getByRole("button", { name: "Looking up topics..." }).waitFor();
    await page.waitForFunction(() => !(document.querySelector("#db-refresh") as HTMLButtonElement).disabled);
    failRefresh = true;
    await page.locator("#db-refresh").click();
    await page.getByText("Could not save this edition.", { exact: true }).waitFor();
    await page.waitForFunction(() => !(document.querySelector("#db-refresh") as HTMLButtonElement).disabled);
    assert.match(await page.locator("#db-topics-body").innerText(), /A new feature/);
    failRefresh = false;
    await page.locator("#db-refresh").click();
    await page.waitForFunction(() => !(document.querySelector("#db-refresh") as HTMLButtonElement).disabled);
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.locator("#db-topics").isVisible(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (process.env.SCREENSHOT_DIR && width !== 900) {
        await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, `briefing-topics-${width}.png`), fullPage: true });
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpectedRequests, []);
    t.diagnostic("Responsive checks complete");
    assert.equal(requests.some((path) => /^\/api\/(?:news|rss|feeds|summaries|ai-security|briefing\/generate)/.test(path)), false);
  } finally {
    await browser.close();
  }
});
