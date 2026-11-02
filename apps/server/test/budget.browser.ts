import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
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

async function seedDemoBudget(base: string, jwt: string) {
  const headers = ownerHeaders(jwt);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const day = `${month}-${String(Math.min(28, now.getDate())).padStart(2, "0")}`;
  const checking = await fetch(`${base}/api/budget/accounts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Demo Checking", type: "checking", openingBalanceCents: 500000 }),
  });
  const { account } = (await checking.json()) as { account: { id: string } };
  const cats = (await (await fetch(`${base}/api/budget/categories`, { headers })).json()) as {
    categories: Array<{ id: string; name: string }>;
  };
  const groceries = cats.categories.find((c) => c.name === "Groceries")!.id;
  await fetch(`${base}/api/budget/transactions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ accountId: account.id, date: day, amountCents: -4523, payee: "Demo Market", categoryId: groceries }),
  });
  await fetch(`${base}/api/budget/accounts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Demo Brokerage", type: "investment", currentBalanceCents: 1250000 }),
  });
  return month;
}

test("budget subscriptions UI: possible-yearly badge, confirm, dismiss, manual add", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-budget-sub-ui-"));
  const app = await openBudgetBrowserServer(dataDir);
  const browser = await chromium.launch();
  try {
    const headers = ownerHeaders(app.ownerJwt);
    const acctRes = await fetch(`${app.base}/api/budget/accounts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Checking", type: "checking" }),
    });
    const { account } = (await acctRes.json()) as { account: { id: string } };
    const cats = (await (await fetch(`${app.base}/api/budget/categories`, { headers })).json()) as {
      categories: Array<{ id: string; name: string }>;
    };
    const streaming = cats.categories.find((c) => c.name === "Streaming")!.id;
    const d1 = new Date();
    d1.setUTCDate(d1.getUTCDate() - 400);
    const d2 = new Date();
    d2.setUTCDate(d2.getUTCDate() - 35);
    const iso1 = d1.toISOString().slice(0, 10);
    const iso2 = d2.toISOString().slice(0, 10);
    await fetch(`${app.base}/api/budget/transactions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ accountId: account.id, date: iso1, amountCents: -9900, payee: "Annual Soft" }),
    });
    await fetch(`${app.base}/api/budget/transactions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ accountId: account.id, date: iso2, amountCents: -9900, payee: "Annual Soft" }),
    });
    await fetch(`${app.base}/api/budget/subscriptions/scan`, { method: "POST", headers, body: "{}" });

    const context = await browser.newContext();
    await context.addCookies([
      { name: "CF_Authorization", value: app.ownerJwt, domain: "127.0.0.1", path: "/" },
    ]);
    const page = await context.newPage();
    await page.goto(`${app.base}/budget?view=subscriptions`);
    await page.waitForFunction(() => document.body.innerText.includes("Possible yearly — please confirm"));
    assert.ok((await page.locator(".ui-badge-warning").count()) >= 1);

    const list = (await (await fetch(`${app.base}/api/budget/subscriptions`, { headers })).json()) as {
      detections: Array<{ id: string }>;
    };
    await fetch(`${app.base}/api/budget/subscriptions/detections/${list.detections[0]!.id}/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({ categoryId: streaming, cadence: "yearly" }),
    });

    const d3 = new Date();
    d3.setUTCDate(d3.getUTCDate() - 120);
    for (const offset of [0, 31, 62]) {
      const d = new Date(d3);
      d.setUTCDate(d.getUTCDate() + offset);
      await fetch(`${app.base}/api/budget/transactions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          accountId: account.id,
          date: d.toISOString().slice(0, 10),
          amountCents: -500,
          payee: "Dismiss Me",
        }),
      });
    }
    await fetch(`${app.base}/api/budget/subscriptions/scan`, { method: "POST", headers, body: "{}" });
    await page.reload();
    await page.waitForSelector("#budget-sub-detections button:has-text('Dismiss')");
    await page.locator("#budget-sub-detections button:has-text('Dismiss')").first().click();
    await page.waitForFunction(async () => {
      const r = await fetch("/api/budget/subscriptions", { headers: { "x-ah": "1" } });
      const j = await r.json();
      return j.detections.length === 0;
    });

    await fetch(`${app.base}/api/budget/subscriptions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        displayName: "Manual Sub",
        amountCents: -1200,
        cadence: "monthly",
        categoryId: streaming,
        anchorDate: "2026-01-01",
      }),
    });
    await page.reload();
    await page.waitForFunction(() => document.body.innerText.includes("Manual Sub"));
    await page.waitForFunction(() => document.body.innerText.includes("Annual Soft"));
  } finally {
    await browser.close();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("budget UI: overview and panel screenshots with demo seed", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-budget-shot-"));
  const app = await openBudgetBrowserServer(dataDir);
  const browser = await chromium.launch();
  const shotDir = process.env.BUDGET_SCREENSHOT_DIR ?? join(tmpdir(), "cc-budget-screenshots");
  await mkdir(shotDir, { recursive: true });
  try {
    await seedDemoBudget(app.base, app.ownerJwt);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([
      { name: "CF_Authorization", value: app.ownerJwt, domain: "127.0.0.1", path: "/" },
    ]);
    const page = await context.newPage();
    const rollupDone = page.waitForResponse((r) => r.url().includes("/api/budget/rollup") && r.ok());
    await page.goto(`${app.base}/budget?view=overview`);
    await rollupDone;
    await page.waitForFunction(() => {
      const v = document.querySelector("#budget-panel-overview .stat-grid .stat-value");
      return v && (v.textContent?.includes("$") ?? false);
    });
    await page.screenshot({ path: `${shotDir}/budget-overview.png`, fullPage: true });
    await page.goto(`${app.base}/budget?view=transactions`);
    await page.waitForSelector("#budget-tx-list table tbody tr");
    await page.screenshot({ path: `${shotDir}/budget-transactions.png`, fullPage: true });
    await page.goto(`${app.base}/budget?view=budget`);
    await page.waitForSelector("#budget-month-grid table");
    await page.screenshot({ path: `${shotDir}/budget-monthly.png`, fullPage: true });
    await page.goto(`${app.base}/`);
    await page.waitForSelector('[data-panel-id="budget"]', { timeout: 20_000 });
    const budgetItem = page.locator('[data-panel-id="budget"]');
    if (await budgetItem.evaluate((el) => el.classList.contains("is-collapsed"))) {
      await budgetItem.locator(".dashboard-collapse").click();
    }
    await page.locator("#budget-panel-net").waitFor({ state: "visible" });
    await page.screenshot({ path: `${shotDir}/budget-panel-blurred.png`, fullPage: true });
    await page.click("#budget-panel-reveal");
    await page.waitForFunction(() =>
      document.querySelector("#budget-panel-net")?.classList.contains("is-revealed"),
    );
    await page.screenshot({ path: `${shotDir}/budget-panel-revealed.png`, fullPage: true });
    await writeFile(join(shotDir, "git-sha.txt"), `${execSync("git rev-parse HEAD", { encoding: "utf8" }).trim()}\n`, "utf8");
  } finally {
    await browser.close();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
