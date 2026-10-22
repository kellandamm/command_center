import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";
import { calendarPage } from "../src/ui/calendar-page";

async function until(page: Page, selector: string, text: string) {
  await page.waitForFunction(({ selector, text }) =>
    document.querySelector(selector)?.textContent?.includes(text), { selector, text });
}

test("Calendar views navigate real date ranges, filter calendars, and show safe event details", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "Pacific/Kiritimati" });
    await page.clock.install({ time: new Date("2030-06-10T15:00:00Z") });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const event = (uid: string, summary: string, start: string, end: string, calendarId = "work", allDay = false) => ({
      uid, summary, start, end, calendarId, allDay, location: "Studio", description: "Discuss designs\nBring notes", url: "https://example.com/event",
    });
    const events = [
      event("early", "Late-night planning", "2030-06-10T01:00:00Z", "2030-06-10T02:00:00Z"),
      event("review", "Design review", "2030-06-10T14:00:00Z", "2030-06-10T15:00:00Z"),
      event("overlap", "Team check-in", "2030-06-10T14:30:00Z", "2030-06-10T15:30:00Z"),
      event("trip", "Personal trip", "2030-06-10T12:00:00Z", "2030-06-12T12:00:00Z", "personal", true),
      event("unsafe", "<img src=x onerror=alert(1)>", "2030-06-11T14:00:00Z", "2030-06-11T15:00:00Z", "personal"),
      event("past", "Previous month event", "2030-05-10T14:00:00Z", "2030-05-10T15:00:00Z"),
    ];
    events[4]!.url = "javascript:alert(1)";
    Object.assign(events[1]!, { readOnly: false, eventId: "native-review", recurrence: "weekly" });
    const requests: Array<{ start: string; end: string }> = [];
    let fail = false, partialFailure = false, configured = true, holdNext = false;
    let release: (() => void) | undefined;
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
    await page.route("http://calendar.test/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/calendar") return route.fulfill({ contentType: "text/html", body: calendarPage() });
      if (url.pathname === "/api/settings") return route.fulfill({ json: { settings: { viewPreferences: { calendar: { weekStartsOn: "sunday" } } } } });
      if (url.pathname === "/api/calendar") {
        const start = url.searchParams.get("start")!, end = url.searchParams.get("end")!;
        requests.push({ start, end });
        if (holdNext) {
          holdNext = false;
          await new Promise<void>((resolve) => { release = resolve; });
        }
        if (fail) return route.fulfill({ status: 502, json: { error: "Feed service unavailable" } });
        return route.fulfill({ json: {
          configured, timezone: "America/Chicago",
          feeds: configured ? [{ id: "work", name: "Work", ok: true }, { id: "personal", name: "Personal", ok: !partialFailure, error: partialFailure ? "HTTP 503" : undefined }] : [],
          events: configured ? events.filter((item) => item.start.slice(0, 10) < end && item.end.slice(0, 10) >= start && (!partialFailure || item.calendarId !== "personal")) : [],
        } });
      }
      return route.fulfill({ json: {} });
    });
    await page.goto("http://calendar.test/calendar");
    await until(page, "#calendar-status-full", "Calendars up to date");
    await until(page, "#cal-timezone", "America/Chicago");
    // Server timezone, not the browser's next-day date, controls the visible period.
    await page.waitForFunction(() => document.querySelector(".calendar-time-column")?.getAttribute("data-date") === "2030-06-09");
    assert.equal(await page.locator(".calendar-time-column").count(), 7);
    assert.equal(await page.locator('.calendar-time-column[data-date="2030-06-09"] .calendar-time-event').count(), 1);
    assert.equal(await page.locator('.calendar-time-column[data-date="2030-06-10"] .calendar-time-event').count(), 2);
    const overlapping = await page.locator('.calendar-time-column[data-date="2030-06-10"] .calendar-time-event').evaluateAll((elements) => elements.map((element) => ({
      left: (element as HTMLElement).style.left, width: (element as HTMLElement).style.width,
    })));
    assert.notEqual(overlapping[0]!.left, overlapping[1]!.left);
    assert.ok(overlapping.every((item) => item.width.includes("50%")));
    assert.equal(await page.locator(".calendar-all-day-cell").filter({ hasText: "Personal trip" }).count(), 2);

    await page.locator('.calendar-time-column[data-date="2030-06-10"]').getByRole("button", { name: /Design review/ }).click();
    await until(page, "#cal-event-title", "Design review");
    await until(page, "#cal-event-time", "9:00");
    await until(page, "#cal-event-location", "Studio");
    assert.equal(await page.locator("#cal-event-description").innerText(), "Discuss designs\nBring notes");
    assert.equal(await page.getByRole("link", { name: "Open event link" }).getAttribute("rel"), "noopener noreferrer");
    assert.equal(await page.locator("#cal-event-edit").getAttribute("href"), "/calendar/event?event=native-review");
    await until(page, "#cal-event-permission", "whole series");
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.locator("#cal-search").fill("Team check-in");
    assert.equal(await page.locator(".calendar-time-event").count(), 1);
    await page.locator("#cal-search").fill("");
    await page.locator(".calendar-source").filter({ hasText: "Personal" }).locator("input").uncheck();
    assert.equal(await page.locator(".calendar-all-day-cell .calendar-event").count(), 0);
    await page.locator(".calendar-source").filter({ hasText: "Personal" }).locator("input").check();

    await page.getByRole("button", { name: "Month", exact: true }).click();
    await page.waitForSelector(".calendar-month");
    assert.equal(await page.locator(".calendar-month-day").count(), 42);
    await page.locator(".calendar-month-day").filter({ hasText: "<img src=x onerror=alert(1)>" }).getByRole("button", { name: /<img/ }).click();
    await until(page, "#cal-event-title", "<img src=x onerror=alert(1)>");
    assert.equal(await page.locator("#cal-event-title img").count(), 0);
    assert.equal(await page.locator("#cal-event-link a").count(), 0);
    assert.equal(await page.locator("#cal-event-edit").isHidden(), true);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Previous period", exact: true }).click();
    await until(page, "#cal-week-label", "May");
    await page.waitForFunction(() => [...document.querySelectorAll(".calendar-month-day")].some((element) => element.textContent?.includes("Previous month event")));
    assert.ok(requests.some((range) => range.start.startsWith("2030-04") && range.end.startsWith("2030-06")));
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await until(page, "#cal-week-label", "June");
    await page.getByRole("button", { name: "Day", exact: true }).click();
    await page.waitForSelector(".calendar-time.day-view");
    assert.equal(await page.locator(".calendar-time-column").count(), 1);
    assert.equal(await page.locator(".calendar-time-column").getAttribute("data-date"), "2030-06-10");
    await page.getByRole("button", { name: "Next mini-calendar month", exact: true }).click();
    await until(page, "#cal-mini-label", "July");
    await page.locator('#cal-mini button[data-date="2030-07-04"]').click();
    await page.waitForFunction(() => document.querySelector(".calendar-time-column")?.getAttribute("data-date") === "2030-07-04");
    await until(page, "#cal-agenda", "Nothing scheduled");
    fail = true;
    await page.getByRole("button", { name: "Refresh calendars", exact: true }).click();
    await until(page, "#calendar-status-full", "Feed service unavailable");
    fail = false;
    await page.getByRole("button", { name: "Refresh calendars", exact: true }).click();
    await until(page, "#calendar-status-full", "Calendars up to date");
    partialFailure = true;
    await page.getByRole("button", { name: "Refresh calendars", exact: true }).click();
    await until(page, "#calendar-status-full", "1 calendar(s) unavailable");
    await until(page, "#cal-sources", "Unavailable");
    partialFailure = false;
    holdNext = true;
    await page.getByRole("button", { name: "Next period", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#calendar-status-full")?.textContent === "Loading calendars…");
    while (!release) await new Promise((resolve) => setTimeout(resolve, 10));
    await page.getByRole("button", { name: "Next period", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".calendar-time-column")?.getAttribute("data-date") === "2030-07-06");
    const oldResponse = page.waitForResponse((response) => response.url().includes("start=2030-07-03"));
    release();
    await oldResponse;
    assert.equal(await page.locator(".calendar-time-column").getAttribute("data-date"), "2030-07-06");
    configured = false;
    await page.getByRole("button", { name: "Refresh calendars", exact: true }).click();
    await until(page, "#calendar-status-full", "No calendars connected");
    assert.equal(await page.locator(".calendar-time-event").count(), 0);
    configured = true;
    await page.getByRole("button", { name: "Refresh calendars", exact: true }).click();
    await until(page, "#calendar-status-full", "Calendars up to date");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await page.waitForSelector(".calendar-time:not(.day-view)");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
