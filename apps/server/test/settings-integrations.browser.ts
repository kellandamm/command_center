import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { capturePage } from "../src/ui/capture-page";
import { calendarSettingsPage } from "../src/ui/calendar-settings-page";
import { settingsPage } from "../src/ui/pages";
import { DEFAULT_SETTINGS } from "../src/settings";

test("capture: failed loading disables writes; replacement/revocation require confirmation and clear one-time tokens", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    let failure = true, configured = true, posts = 0, deletes = 0;
    await page.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname !== "integrations.test") return route.abort();
      if (url.pathname === "/settings/capture") return route.fulfill({ contentType: "text/html", body: capturePage() });
      if (url.pathname === "/api/settings") return route.fulfill({ json: { settings: DEFAULT_SETTINGS, meta: { canManage: true } } });
      if (url.pathname === "/api/capture/access") {
        if (failure) return route.fulfill({ status: 503, json: { error: "Token state unavailable" } });
        if (request.method() === "POST") { posts++; configured = true; return route.fulfill({ json: { token: "one-time-capture-token" } }); }
        if (request.method() === "DELETE") { deletes++; configured = false; }
        return route.fulfill({ json: { configured } });
      }
      return route.fulfill({ status: 404 });
    });
    await page.goto("http://integrations.test/settings/capture");
    await page.getByText("Token state unavailable", { exact: true }).waitFor();
    assert.equal(await page.locator("#capture-create").isDisabled(), true);
    failure = false; await page.locator("#capture-retry").click();
    await page.getByText("A capture token is active. Its value cannot be retrieved.", { exact: true }).waitFor();
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.locator("#capture-create").click(); assert.equal(posts, 0);
    page.once("dialog", (dialog) => dialog.accept()); await page.locator("#capture-create").click();
    await page.locator("#capture-token-box").waitFor();
    assert.equal(posts, 1); assert.equal(await page.locator("#capture-token").inputValue(), "one-time-capture-token");
    assert.ok(!(await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))).includes("one-time-capture-token"));
    page.once("dialog", (dialog) => dialog.dismiss()); await page.locator("#capture-revoke").click(); assert.equal(deletes, 0);
    page.once("dialog", (dialog) => dialog.accept()); await page.locator("#capture-revoke").click();
    await page.getByText("Capture access revoked.", { exact: true }).waitFor();
    assert.equal(deletes, 1); assert.equal(await page.locator("#capture-token").inputValue(), "");
    assert.equal(await page.locator("#capture-token-box").isHidden(), true);
    assert.equal(await page.locator('a[href="/settings"].on').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("calendar settings: independent rename drafts survive saves; conflict review and Google Cancel preserve user control", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    const calendars = [
      { id: "work", name: "Work", kind: "native", enabled: true, sharing: false, version: 1 },
      { id: "personal", name: "Personal", kind: "native", enabled: true, sharing: false, version: 1 },
    ];
    let conflict = false;
    await page.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname !== "integrations.test") return route.abort();
      if (url.pathname === "/settings/calendars") return route.fulfill({ contentType: "text/html", body: calendarSettingsPage() });
      if (url.pathname === "/api/settings") return route.fulfill({ json: { settings: DEFAULT_SETTINGS, revision: "settings-v1", meta: { canManage: true } } });
      if (url.pathname === "/api/calendars") return route.fulfill({ json: { calendars, canManage: true, credentialsWritable: true, timezone: "UTC", google: { configured: true, credentialsWritable: true, connected: true } } });
      if (url.pathname === "/api/google-calendar/calendars") return route.fulfill({ json: { calendars: [{ id: "google-work", name: "Google work", selected: true, writable: true }] } });
      if (url.pathname.startsWith("/api/calendars/") && request.method() === "PUT") {
        const calendar = calendars.find((item) => item.id === url.pathname.split("/")[3])!;
        if (conflict) { conflict = false; calendar.name = "Renamed elsewhere"; calendar.version++; return route.fulfill({ status: 409, json: { error: "This calendar item changed elsewhere. Review before editing." } }); }
        assert.equal(request.postDataJSON().expectedVersion, calendar.version);
        calendar.name = request.postDataJSON().name; calendar.version++;
        return route.fulfill({ json: { calendar } });
      }
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto("http://integrations.test/settings/calendars");
    await page.getByLabel("Google work", { exact: true }).uncheck();
    const work = page.locator('[data-calendar-id="work"]'), personal = page.locator('[data-calendar-id="personal"]');
    await work.getByText("Manage Work", { exact: true }).click(); await personal.getByText("Manage Personal", { exact: true }).click();
    await personal.getByRole("button", { name: "Rename", exact: true }).click(); await personal.getByLabel("Calendar name").fill("Personal draft");
    await work.getByRole("button", { name: "Rename", exact: true }).click(); await work.getByLabel("Calendar name").fill("Team");
    await work.getByRole("button", { name: "Save name", exact: true }).click();
    await page.getByText("Calendar name saved.", { exact: true }).waitFor();
    assert.equal(await personal.getByLabel("Calendar name").inputValue(), "Personal draft");
    assert.equal(await page.getByLabel("Google work", { exact: true }).isChecked(), false);
    await page.locator("#google-calendar-list").getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.getByLabel("Google work", { exact: true }).isChecked(), true);
    conflict = true; await personal.getByRole("button", { name: "Save name", exact: true }).click();
    await personal.getByRole("button", { name: "Review current calendar" }).waitFor();
    assert.equal(await personal.getByLabel("Calendar name").inputValue(), "Personal draft");
    page.once("dialog", (dialog) => dialog.accept()); await personal.getByRole("button", { name: "Review current calendar" }).click();
    await personal.getByText("Current version reviewed. Save your draft when ready.", { exact: true }).waitFor();
    await personal.getByRole("button", { name: "Save name", exact: true }).click();
    await personal.getByRole("heading", { name: "Personal draft", exact: true }).waitFor();
    assert.equal(calendars[1]!.name, "Personal draft");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("notifications: pending tests block duplicate clicks and recover from failure", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    let posts = 0, release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname !== "integrations.test") return route.abort();
      if (url.pathname === "/settings") return route.fulfill({ contentType: "text/html", body: settingsPage() });
      if (url.pathname === "/api/settings") return route.fulfill({ json: { settings: DEFAULT_SETTINGS, meta: { canManage: true }, ntfy: { enabled: true, canTest: true, quietHours: "22:00-07:00", reminderMinutes: 10, coachEnabled: false } } });
      if (url.pathname === "/api/notify/test") { posts++; await wait; return route.fulfill({ status: 502, json: { error: "Notification delivery unavailable" } }); }
      return route.fulfill({ status: 404 });
    });
    await page.goto("http://integrations.test/settings#notifications");
    await page.waitForFunction(() => !(document.getElementById("ntfy-test") as HTMLButtonElement).disabled);
    assert.match(await page.locator("#ntfy-details").innerText(), /22:00-07:00/);
    await page.locator("#ntfy-test").click();
    assert.equal(await page.locator("#ntfy-test").isDisabled(), true);
    await page.locator("#ntfy-test").evaluate((button: HTMLButtonElement) => { button.dispatchEvent(new MouseEvent("click")); });
    release!();
    await page.getByText("Notification delivery unavailable", { exact: true }).waitFor();
    assert.equal(posts, 1); assert.equal(await page.locator("#ntfy-test").isEnabled(), true);
  } finally { await browser.close(); }
});
