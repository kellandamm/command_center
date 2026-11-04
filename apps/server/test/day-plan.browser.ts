import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { SettingsStore } from "../src/settings";
import { NotesStore } from "../src/notes/store";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";
import { CalendarWorkspace } from "../src/calendar/workspace";
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "./cf-access-jwt";
import { PLAN_TEST_TZ } from "./day-plan-relative-days";
import { dayKey } from "../src/store";

async function openDayPlanBrowser(dataDir: string) {
  const cfKeys = await createTestCfAccessJwt();
  const cfg = loadConfig({
    DATA_DIR: dataDir,
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: TEST_CF_AUD,
    OWNER_EMAILS: "owner@example.com",
    TZ: PLAN_TEST_TZ,
  });
  const settings = new SettingsStore(dataDir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dataDir, cfg.tz);
  const notes = await NotesStore.open(dataDir);
  const integration = await openIntegrationStores(dataDir, cfg);
  const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board: integration.board });
  const today = dayKey(new Date(), PLAN_TEST_TZ);
  integration.board.create({ title: "Browser must-do", dueDate: today, estimatedMinutes: 25, priority: "high" });
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async (token) => cfKeys.verifier(token)),
    settings,
    dailyBriefing,
    notes,
    calendar,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ownerJwt = await cfKeys.signEmailJwt("owner@example.com");
  const close = async () => {
    await closeIntegrationServer(server, integration);
  };
  return { base, ownerJwt, close, today };
}

test("day-plan page: sync conflict banner stays visible after plan reload", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-day-plan-conflict-"));
  const app = await openDayPlanBrowser(dataDir);
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "CF_Authorization", value: app.ownerJwt, domain: "127.0.0.1", path: "/" },
    ]);
    const page = await context.newPage();
    let planLoads = 0;
    await page.route("**/api/day-plan/must-do/complete", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Sync conflict for test.",
          mustDoSyncConflict: true,
          remoteTask: { source: "board", refId: "card-test" },
        }),
      });
    });
    await page.route("**/api/day-plan?day=*", async (route) => {
      planLoads += 1;
      await route.continue();
    });
    await page.goto(`${app.base}/day-plan`);
    await page.waitForSelector("#dp-timeline");
    await page.waitForFunction(() => {
      const box = document.querySelector("#dp-must-dos input[type=checkbox]:not(:disabled)");
      return !!box;
    }, { timeout: 45_000 });
    const box = page.locator("#dp-must-dos input[type=checkbox]:not(:disabled)").first();
    await box.check();
    await page.waitForSelector("#dp-sync-conflict:not([hidden])");
    await page.waitForFunction(() => planLoads >= 1, { timeout: 45_000 });
    assert.equal(await page.locator("#dp-sync-conflict:not([hidden])").count(), 1);
  } finally {
    await browser.close();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("day-plan page: loads plan and completes must-do with undo", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-day-plan-browser-"));
  const app = await openDayPlanBrowser(dataDir);
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "CF_Authorization", value: app.ownerJwt, domain: "127.0.0.1", path: "/" },
    ]);
    const page = await context.newPage();
    await page.goto(`${app.base}/day-plan`);
    await page.waitForSelector("#dp-timeline");
    await page.waitForFunction(() => {
      const box = document.querySelector("#dp-must-dos input[type=checkbox]:not(:disabled)");
      return !!box;
    }, { timeout: 45_000 });
    const box = page.locator("#dp-must-dos input[type=checkbox]:not(:disabled)").first();
    await box.check();
    await page.waitForSelector("#dp-toast:not([hidden])");
    await page.locator("#dp-toast-undo").click();
    await page.waitForSelector("#dp-must-dos input[type=checkbox]:not(:checked):not(:disabled)");
    assert.equal(await page.locator("#dp-banner:not([hidden])").count(), 0);
  } finally {
    await browser.close();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
