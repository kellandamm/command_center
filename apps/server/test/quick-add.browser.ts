import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { CalendarWorkspace } from "../src/calendar/workspace";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const TOKEN = "b".repeat(32);

test("dashboard quick add previews and commits through stubbed APIs", { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-quick-add-browser-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    ALLOW_INSECURE_NO_AUTH: "1",
    TZ: "America/Chicago",
    LLM_BASE_URL: "https://llm.example/v1",
    LLM_API_KEY: "key",
    LLM_MODEL: "model",
    TODOIST_API_TOKEN: "todoist-token",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board: integration.board });
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg),
    settings,
    dailyBriefing,
    notes,
    calendar,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch();
  let commitCalled = false;
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { authorization: `Bearer ${TOKEN}`, "x-ah": "1" },
    });
    const page = await context.newPage();
    await page.route("**/api/quick-add/parse", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [{ kind: "task", title: "Call mom", due: "2026-10-26T15:00" }],
        }),
      });
    });
    await page.route("**/api/quick-add/commit", async (route) => {
      commitCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [{ kind: "task", title: "Call mom", url: "https://todoist.com/showTask?id=1", id: "1" }],
        }),
      });
    });
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await page.fill("#dashboard-quick-add .quick-add-input", "call mom tomorrow 3pm");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#dashboard-quick-add .quick-add-preview:not([hidden])", { timeout: 10_000 });
    const commitResponse = page.waitForResponse((res) => res.url().includes("/api/quick-add/commit") && res.request().method() === "POST");
    await page.getByRole("button", { name: "Confirm" }).click();
    const res = await commitResponse;
    assert.equal(res.ok(), true);
    assert.equal(commitCalled, true);
  } finally {
    await context?.close().catch(() => {});
    await browser.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
