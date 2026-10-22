import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { CalendarStore } from "../src/calendar/store";
import { calendarEventPage } from "../src/ui/calendar-event-page";
import { calendarSettingsPage } from "../src/ui/calendar-settings-page";

test("native event form preserves drafts on conflicts, uses its selected timezone, and manages all-day events", { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-calendar-browser-"));
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL });
  try {
    const store = await CalendarStore.open(dir);
    const calendar = await store.create({ kind: "native", name: "Work" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "Pacific/Kiritimati" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let conflict = false, owner = true;
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
    await page.route("http://calendar.test/**", async (route) => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (path === "/calendar/event") return route.fulfill({ contentType: "text/html", body: calendarEventPage() });
      if (path === "/settings/calendars") return route.fulfill({ contentType: "text/html", body: calendarSettingsPage() });
      if (path === "/calendar") return route.fulfill({ contentType: "text/html", body: "<h1>Calendar</h1>" });
      if (path === "/api/knowledge") return route.fulfill({ json: { notes: [{ id: "note-1", title: "Agenda" }], spaces: [{ id: "space-1", name: "Project" }] } });
      if (path === "/api/calendars") return route.fulfill({ json: { calendars: store.list(), timezone: "America/Chicago", credentialsWritable: false, canManage: owner } });
      const eventId = path.split("/")[3];
      if (path.startsWith("/api/calendar-events")) {
        if (request.method() === "GET") return route.fulfill({ json: { event: store.event(eventId!) } });
        if (conflict) return route.fulfill({ status: 409, json: { error: "This calendar item changed elsewhere. Refresh before editing; your changes have not been applied." } });
        try {
          const body = request.postDataJSON();
          if (request.method() === "DELETE") {
            await store.deleteEvent(eventId!, body.expectedVersion);
            return route.fulfill({ json: { ok: true } });
          }
          const event = await store.saveEvent(body, eventId);
          return route.fulfill({ json: { event } });
        } catch (error) {
          return route.fulfill({ status: 400, json: { error: error instanceof Error ? error.message : "Save failed" } });
        }
      }
      return route.fulfill({ json: {} });
    });
    await page.goto("http://calendar.test/calendar/event");
    await page.waitForSelector("#event-form:not([hidden])");
    await page.locator("#event-title").fill("Focus session");
    await page.locator("#event-start").fill("2030-06-10T09:00");
    await page.locator("#event-end").fill("2030-06-10T10:00");
    await page.locator("#event-note").selectOption("note-1");
    await page.locator("#event-space").selectOption("space-1");
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#event-save-status")?.textContent?.includes("Event saved"));
    const event = store.events()[0]!;
    assert.equal(event.start, "2030-06-10T14:00:00.000Z");
    assert.equal(event.noteId, "note-1");
    assert.equal(event.spaceId, "space-1");
    assert.ok(page.url().includes(`event=${event.id}`));
    await page.goto(page.url());
    await page.waitForSelector("#event-form:not([hidden])");
    assert.equal(await page.locator("#event-start").inputValue(), "2030-06-10T09:00");
    await page.locator("#event-title").fill("Unsaved conflict draft");
    conflict = true;
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#event-save-status")?.textContent?.includes("changed elsewhere"));
    assert.equal(await page.locator("#event-title").inputValue(), "Unsaved conflict draft");
    assert.equal(store.event(event.id)?.summary, "Focus session");
    conflict = false;
    await page.locator("#event-all-day").check();
    await page.locator("#event-start").fill("2030-06-11");
    await page.locator("#event-end").fill("2030-06-12");
    await page.locator("#event-repeat").selectOption("weekly");
    await page.locator("#event-until").fill("2030-07-01");
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#event-save-status")?.textContent?.includes("Event saved"));
    assert.equal(store.event(event.id)?.allDay, true);
    assert.equal(store.event(event.id)?.start, "2030-06-11");
    assert.equal(store.event(event.id)?.recurrence, "weekly");
    if (process.env.CALENDAR_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.CALENDAR_SCREENSHOT_DIR, "calendar-event-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.CALENDAR_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.CALENDAR_SCREENSHOT_DIR, "calendar-event-mobile.png"), fullPage: true });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete event", exact: true }).click();
    await page.waitForURL("http://calendar.test/calendar");
    assert.equal(store.events().length, 0);
    owner = false;
    await page.goto("http://calendar.test/calendar/event");
    await page.waitForFunction(() => document.querySelector("#event-load-status")?.textContent?.includes("configured owner"));
    assert.equal(await page.locator("#event-form").isHidden(), true);
    await page.goto("http://calendar.test/settings/calendars");
    await page.waitForFunction(() => document.querySelector("#calendar-settings-status")?.textContent?.includes("configured owner"));
    assert.equal(await page.locator("#calendar-add").isHidden(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});
