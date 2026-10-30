import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

const XSS = '<img src=x onerror=alert(1)>';

async function openBudgetBrowserServer(dataDir: string) {
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
  const close = async () => {
    budget?.close();
    await closeIntegrationServer(server, integration);
  };
  return { base, ownerJwt, close };
}

function ownerHeaders(jwt: string) {
  return {
    cookie: `CF_Authorization=${jwt}`,
    "content-type": "application/json",
    "x-ah": "1",
  };
}

test("budget import UI: XSS payee renders as inert text", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-budget-xss-"));
  const app = await openBudgetBrowserServer(dataDir);
  const browser = await chromium.launch();
  try {
    const acctRes = await fetch(`${app.base}/api/budget/accounts`, {
      method: "POST",
      headers: ownerHeaders(app.ownerJwt),
      body: JSON.stringify({ name: "Checking", type: "checking" }),
    });
    const { account } = (await acctRes.json()) as { account: { id: string } };
    const csvPath = join(dataDir, "xss.csv");
    await writeFile(csvPath, `Date,Description,Amount\n06/10/2026,${XSS},-1.00\n`);

    const context = await browser.newContext();
    await context.addCookies([
      { name: "CF_Authorization", value: app.ownerJwt, domain: "127.0.0.1", path: "/" },
    ]);
    const page = await context.newPage();
    await page.goto(`${app.base}/budget?view=import&account=${account.id}`);
    await page.waitForSelector("#budget-import-account");
    await page.selectOption("#budget-import-account", account.id);
    await page.setInputFiles("#budget-import-file", csvPath);
    await page.click("#budget-preview-btn");
    await page.waitForSelector("#budget-preview-table tbody tr");
    assert.equal(await page.locator("#budget-preview-table tbody img").count(), 0);
    const payeeText = await page.locator("#budget-preview-table tbody tr td:nth-child(4)").innerText();
    assert.equal(payeeText, XSS);
  } finally {
    await browser.close();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("budget accounts UI: XSS account name renders as inert text", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-budget-acct-xss-"));
  const app = await openBudgetBrowserServer(dataDir);
  const browser = await chromium.launch();
  try {
    const acctRes = await fetch(`${app.base}/api/budget/accounts`, {
      method: "POST",
      headers: ownerHeaders(app.ownerJwt),
      body: JSON.stringify({ name: XSS, type: "checking" }),
    });
    assert.ok(acctRes.ok, `create account: ${acctRes.status}`);

    const context = await browser.newContext();
    await context.addCookies([
      { name: "CF_Authorization", value: app.ownerJwt, domain: "127.0.0.1", path: "/" },
    ]);
    const page = await context.newPage();
    await page.goto(`${app.base}/budget?view=accounts`);
    await page.waitForSelector("#budget-panel-accounts table tbody tr", { timeout: 20_000 });
    assert.equal(await page.locator("#budget-panel-accounts img").count(), 0);
    const nameText = await page.locator("#budget-panel-accounts table tbody tr td:first-child").innerText();
    assert.equal(nameText, XSS);
  } finally {
    await browser.close();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("budget import UI: invert checkbox checked for saved inverted credit account", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-budget-invert-ui-"));
  const app = await openBudgetBrowserServer(dataDir);
  const browser = await chromium.launch();
  try {
    const acctRes = await fetch(`${app.base}/api/budget/accounts`, {
      method: "POST",
      headers: ownerHeaders(app.ownerJwt),
      body: JSON.stringify({ name: "Card", type: "credit", invertSign: true }),
    });
    const { account } = (await acctRes.json()) as { account: { id: string } };
    const csvPath = join(dataDir, "card.csv");
    await writeFile(csvPath, "Date,Description,Amount\n06/11/2026,Shop,-25.00\n");

    const context = await browser.newContext();
    await context.addCookies([
      { name: "CF_Authorization", value: app.ownerJwt, domain: "127.0.0.1", path: "/" },
    ]);
    const page = await context.newPage();
    await page.goto(`${app.base}/budget?view=import&account=${account.id}`);
    await page.waitForSelector("#budget-import-account");
    await page.selectOption("#budget-import-account", account.id);
    await page.setInputFiles("#budget-import-file", csvPath);
    await page.click("#budget-preview-btn");
    await page.waitForSelector("#budget-preview-table tbody tr");
    assert.equal(await page.locator("#budget-invert-confirm").isChecked(), true);
  } finally {
    await browser.close();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
