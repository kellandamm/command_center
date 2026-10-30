import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
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
import { BudgetStore } from "../src/budget/store";
import { budgetAvailable } from "../src/budget/gate";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "./cf-access-jwt";

async function openPaletteServer(viewerEmail?: string) {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-cp-browser-"));
  const cfKeys = await createTestCfAccessJwt();
  const cfg = loadConfig({
    DATA_DIR: dataDir,
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: TEST_CF_AUD,
    OWNER_EMAILS: "owner@example.com",
    TZ: "UTC",
  });
  const settings = new SettingsStore(dataDir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dataDir, cfg.tz);
  const notes = await NotesStore.open(dataDir);
  const integration = await openIntegrationStores(dataDir, cfg);
  const budget = budgetAvailable(cfg) ? BudgetStore.open(dataDir) : undefined;
  if (budget) {
    const acct = budget.createAccount({ name: "Checking", type: "checking" });
    budget.commitImport({
      accountId: acct.id,
      fileName: "x.csv",
      fileSha256: "sha",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD", amountColumn: "Amount" },
      invertSign: false,
      rows: [
        {
          rowNumber: 2,
          date: "2026-01-01",
          amountCents: -10,
          payee: "BrowserBudgetPayee",
          memo: "",
          categoryId: null,
          fingerprint: "fp-browser",
        },
      ],
    });
  }
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async (token) => cfKeys.verifier(token)),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ownerJwt = await cfKeys.signEmailJwt("owner@example.com");
  const viewerJwt = await cfKeys.signEmailJwt(viewerEmail ?? "viewer@example.com");
  const close = async () => {
    budget?.close();
    await closeIntegrationServer(server, integration);
    await rm(dataDir, { recursive: true, force: true });
  };
  return { base, ownerJwt, viewerJwt, close };
}

async function withBrowser(fn: (browser: Browser) => Promise<void>) {
  const browser = await chromium.launch();
  try {
    await fn(browser);
  } finally {
    await browser.close();
  }
}

async function openPalette(page: Page) {
  await page.keyboard.press("Control+k");
  await page.waitForSelector("#command-palette-overlay.open", { timeout: 8000 });
}

test("command palette browser: open, trap, arrows, enter, esc restores focus", { timeout: 120_000 }, async () => {
  const app = await openPaletteServer();
  await withBrowser(async (browser) => {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "CF_Authorization", value: app.ownerJwt, domain: "127.0.0.1", path: "/" },
    ]);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${app.base}/`);
    await page.waitForSelector("#sidebar-toggle");
    await page.locator("#sidebar-toggle").focus();
    const priorId = "sidebar-toggle";
    await openPalette(page);
    assert.equal(await page.evaluate(() => document.querySelector(".sidebar-inset")?.hasAttribute("inert")), true);
    await page.fill("#command-palette-input", "Settings");
    await page.waitForFunction(() => {
      const opts = document.querySelectorAll(".command-palette-option");
      return opts.length > 0 && /Settings/i.test(document.body.innerText);
    });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/settings/, { timeout: 8000 });
    await page.goto(`${app.base}/`);
    await page.locator("#sidebar-toggle").focus();
    await openPalette(page);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("command-palette-overlay")?.classList.contains("open"));
    await page.waitForFunction((expected) => document.activeElement?.id === expected, priorId);
  });
  await app.close();
});

test("command palette browser: non-owner has no budget hits or Budget nav", { timeout: 120_000 }, async () => {
  const app = await openPaletteServer();
  await withBrowser(async (browser) => {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "CF_Authorization", value: app.viewerJwt, domain: "127.0.0.1", path: "/" },
    ]);
    const page = await context.newPage();
    await page.goto(`${app.base}/`);
    await page.waitForSelector(".app-shell");
    const api = await page.evaluate(async () => {
      const r = await fetch("/api/command-palette/search?q=BrowserBudget", { headers: { "x-ah": "1" } });
      return r.json();
    });
    const results = (api as { results: Array<{ type: string; title: string }> }).results;
    assert.ok(!results.some((r) => r.type === "budget-tx"));
    await openPalette(page);
    await page.fill("#command-palette-input", "Budget");
    await sleep(400);
    const listText = await page.locator("#command-palette-listbox").innerText();
    assert.ok(!listText.includes("Budget"));
  });
  await app.close();
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
