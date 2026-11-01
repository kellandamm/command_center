import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
import type { AddressInfo } from "node:net";

const PROMPT_STUB = `
window.__subPromptQueue = [];
window.__subConfirmQueue = [];
window.__setSubPromptQueue = function(q) { window.__subPromptQueue = q.slice(); };
window.__setSubConfirmQueue = function(q) { window.__subConfirmQueue = q.slice(); };
window.prompt = function() { return window.__subPromptQueue.length ? window.__subPromptQueue.shift() : null; };
window.confirm = function() { return window.__subConfirmQueue.length ? !!window.__subConfirmQueue.shift() : true; };
`;

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

async function expenseCategoryIndex(base: string, jwt: string, name: string): Promise<number> {
  const headers = ownerHeaders(jwt);
  const payload = (await (await fetch(`${base}/api/budget/categories`, { headers })).json()) as {
    categories: Array<{ id: string; name: string; groupId: string }>;
    groups: Array<{ id: string; isIncome: boolean }>;
  };
  const expense = payload.categories.filter(
    (c) => !payload.groups.find((g) => g.id === c.groupId && g.isIncome),
  );
  const idx = expense.findIndex((c) => c.name === name);
  assert.ok(idx >= 0, `category ${name}`);
  return idx + 1;
}

async function categoryId(base: string, jwt: string, name: string): Promise<string> {
  const headers = ownerHeaders(jwt);
  const payload = (await (await fetch(`${base}/api/budget/categories`, { headers })).json()) as {
    categories: Array<{ id: string; name: string }>;
  };
  return payload.categories.find((c) => c.name === name)!.id;
}

async function seedAccount(base: string, jwt: string) {
  const headers = ownerHeaders(jwt);
  const acctRes = await fetch(`${base}/api/budget/accounts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Checking", type: "checking" }),
  });
  const { account } = (await acctRes.json()) as { account: { id: string } };
  return { headers, accountId: account.id };
}

async function addMonthlyCharges(
  base: string,
  headers: Record<string, string>,
  accountId: string,
  payee: string,
  amountCents: number,
  count = 3,
) {
  const baseDate = new Date();
  baseDate.setUTCDate(baseDate.getUTCDate() - 120);
  for (let i = 0; i < count; i++) {
    const d = new Date(baseDate);
    d.setUTCDate(d.getUTCDate() + i * 31);
    await fetch(`${base}/api/budget/transactions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ accountId, date: d.toISOString().slice(0, 10), amountCents, payee }),
    });
  }
  await fetch(`${base}/api/budget/subscriptions/scan`, { method: "POST", headers, body: "{}" });
}

async function openSubscriptionsPage(base: string, jwt: string) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([
    { name: "CF_Authorization", value: jwt, domain: "127.0.0.1", path: "/" },
  ]);
  const page = await context.newPage();
  await page.addInitScript(PROMPT_STUB);
  await page.goto(`${base}/budget?view=subscriptions`);
  return { browser, page };
}

test("budget subscriptions UI: confirm pending detection creates active row", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-sub-ui-confirm-"));
  const app = await openBudgetBrowserServer(dataDir);
  try {
    const { headers, accountId } = await seedAccount(app.base, app.ownerJwt);
    const catIdx = await expenseCategoryIndex(app.base, app.ownerJwt, "Streaming");
    await addMonthlyCharges(app.base, headers, accountId, "UI Confirm Co", -888, 3);
    const { browser, page } = await openSubscriptionsPage(app.base, app.ownerJwt);
    try {
      await page.waitForSelector("#budget-sub-detections button:has-text('Confirm')");
      const confirmBodies: Array<{ deactivateConflictingActive?: boolean }> = [];
      page.on("request", (req) => {
        if (req.method() === "POST" && req.url().includes("/confirm")) {
          confirmBodies.push(JSON.parse(req.postData() || "{}") as { deactivateConflictingActive?: boolean });
        }
      });
      await page.evaluate(
        ({ cat }) => {
          (window as unknown as { __setSubPromptQueue: (q: string[]) => void }).__setSubPromptQueue([
            String(cat),
            "monthly",
          ]);
        },
        { cat: catIdx },
      );
      await page.locator("#budget-sub-detections button:has-text('Confirm')").first().click();
      await page.waitForFunction(() => document.body.innerText.includes("UI Confirm Co"));
      assert.equal(confirmBodies.length, 1);
      assert.equal(confirmBodies[0]!.deactivateConflictingActive, false);
    } finally {
      await browser.close();
    }
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("budget subscriptions UI: price conflict confirm cancel keeps both active", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-sub-ui-conflict-cancel-"));
  const app = await openBudgetBrowserServer(dataDir);
  try {
    const { headers, accountId } = await seedAccount(app.base, app.ownerJwt);
    const catIdx = await expenseCategoryIndex(app.base, app.ownerJwt, "Streaming");
    const streamingId = await categoryId(app.base, app.ownerJwt, "Streaming");
    await fetch(`${app.base}/api/budget/subscriptions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        displayName: "Netflix Old",
        payee: "NETFLIX.COM",
        amountCents: -1549,
        cadence: "monthly",
        categoryId: streamingId,
        anchorDate: "2025-01-05",
      }),
    });
    await addMonthlyCharges(app.base, headers, accountId, "NETFLIX.COM", -1799, 4);
    const { browser, page } = await openSubscriptionsPage(app.base, app.ownerJwt);
    try {
      await page.waitForSelector("#budget-sub-detections button:has-text('Confirm')");
      const confirmBodies: Array<{ deactivateConflictingActive?: boolean }> = [];
      page.on("request", (req) => {
        if (req.method() === "POST" && req.url().includes("/confirm")) {
          confirmBodies.push(JSON.parse(req.postData() || "{}") as { deactivateConflictingActive?: boolean });
        }
      });
      await page.evaluate(
        ({ cat }) => {
          (window as unknown as { __setSubPromptQueue: (q: string[]) => void }).__setSubPromptQueue([
            String(cat),
            "monthly",
          ]);
          (window as unknown as { __setSubConfirmQueue: (q: boolean[]) => void }).__setSubConfirmQueue([false]);
        },
        { cat: catIdx },
      );
      await page.locator("#budget-sub-detections button:has-text('Confirm')").first().click();
      await page.waitForFunction(async () => {
        const r = await fetch("/api/budget/subscriptions", { headers: { "x-ah": "1" } });
        const j = (await r.json()) as { subscriptions: Array<{ active: boolean }> };
        return j.subscriptions.filter((s) => s.active).length === 2;
      });
      assert.equal(confirmBodies[0]!.deactivateConflictingActive, false);
    } finally {
      await browser.close();
    }
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("budget subscriptions UI: price conflict confirm OK deactivates older subscription", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-sub-ui-conflict-ok-"));
  const app = await openBudgetBrowserServer(dataDir);
  try {
    const { headers, accountId } = await seedAccount(app.base, app.ownerJwt);
    const catIdx = await expenseCategoryIndex(app.base, app.ownerJwt, "Streaming");
    const streamingId = await categoryId(app.base, app.ownerJwt, "Streaming");
    const old = await fetch(`${app.base}/api/budget/subscriptions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        displayName: "Netflix Old",
        payee: "NETFLIX.COM",
        amountCents: -1549,
        cadence: "monthly",
        categoryId: streamingId,
        anchorDate: "2025-01-05",
      }),
    });
    const { subscription: oldSub } = (await old.json()) as { subscription: { id: string } };
    await addMonthlyCharges(app.base, headers, accountId, "NETFLIX.COM", -1799, 4);
    const { browser, page } = await openSubscriptionsPage(app.base, app.ownerJwt);
    try {
      await page.waitForSelector("#budget-sub-detections button:has-text('Confirm')");
      await page.evaluate(
        ({ cat }) => {
          (window as unknown as { __setSubPromptQueue: (q: string[]) => void }).__setSubPromptQueue([
            String(cat),
            "monthly",
          ]);
          (window as unknown as { __setSubConfirmQueue: (q: boolean[]) => void }).__setSubConfirmQueue([true]);
        },
        { cat: catIdx },
      );
      await page.locator("#budget-sub-detections button:has-text('Confirm')").first().click();
      await page.waitForFunction(async () => {
        const r = await fetch("/api/budget/subscriptions", { headers: { "x-ah": "1" } });
        const j = (await r.json()) as {
          subscriptions: Array<{ id: string; amountCents: number; active: boolean }>;
        };
        return (
          j.subscriptions.filter((s) => s.active).length === 1 &&
          j.subscriptions.some((s) => s.active && s.amountCents === -1799)
        );
      });
      const all = (await (
        await fetch(`${app.base}/api/budget/subscriptions`, { headers })
      ).json()) as { subscriptions: Array<{ id: string; active: boolean }> };
      const oldRow = all.subscriptions.find((s) => s.id === oldSub.id);
      assert.ok(!oldRow?.active);
    } finally {
      await browser.close();
    }
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("budget subscriptions UI: dismiss, edit, deactivate, and manual add", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-sub-ui-mutations-"));
  const app = await openBudgetBrowserServer(dataDir);
  try {
    const { headers, accountId } = await seedAccount(app.base, app.ownerJwt);
    const streamingIdx = await expenseCategoryIndex(app.base, app.ownerJwt, "Streaming");
    const generalIdx = await expenseCategoryIndex(app.base, app.ownerJwt, "General");
    await addMonthlyCharges(app.base, headers, accountId, "Dismiss Target", -555, 3);
    const { browser, page } = await openSubscriptionsPage(app.base, app.ownerJwt);
    try {
      await page.waitForSelector("#budget-sub-detections button:has-text('Dismiss')");
      await page.locator("#budget-sub-detections button:has-text('Dismiss')").first().click();
      await page.waitForFunction(async () => {
        const r = await fetch("/api/budget/subscriptions", { headers: { "x-ah": "1" } });
        const j = await r.json();
        return j.detections.length === 0;
      });

      await addMonthlyCharges(app.base, headers, accountId, "Edit Target", -999, 3);
      await page.reload();
      await page.waitForSelector("#budget-sub-detections button:has-text('Confirm')");
      await page.evaluate(
        ({ cat }) => {
          (window as unknown as { __setSubPromptQueue: (q: string[]) => void }).__setSubPromptQueue([
            String(cat),
            "monthly",
          ]);
        },
        { cat: streamingIdx },
      );
      await page.locator("#budget-sub-detections button:has-text('Confirm')").first().click();
      await page.waitForFunction(() => document.body.innerText.includes("Edit Target"));

      await page.evaluate(() => {
        (window as unknown as { __setSubPromptQueue: (q: string[]) => void }).__setSubPromptQueue([
          "20.00",
          "monthly",
          "2025-06-01",
        ]);
      });
      await page.locator("#budget-sub-active button:has-text('Edit')").first().click();
      await page.waitForFunction(async () => {
        const r = await fetch("/api/budget/subscriptions", { headers: { "x-ah": "1" } });
        const j = (await r.json()) as { subscriptions: Array<{ amountCents: number }> };
        return j.subscriptions.some((s) => s.amountCents === -2000);
      });

      await page.evaluate(() => {
        (window as unknown as { __setSubConfirmQueue: (q: boolean[]) => void }).__setSubConfirmQueue([true]);
      });
      await page.locator("#budget-sub-active button:has-text('Deactivate')").first().click();
      await page.waitForFunction(async () => {
        const r = await fetch("/api/budget/subscriptions", { headers: { "x-ah": "1" } });
        const j = (await r.json()) as { subscriptions: unknown[] };
        return j.subscriptions.length === 0;
      });

      await page.evaluate(
        ({ gIdx }) => {
          (window as unknown as { __setSubPromptQueue: (q: string[]) => void }).__setSubPromptQueue([
            "Manual From UI",
            "MANUAL PAYEE UI",
            "monthly",
            "12.50",
            String(gIdx),
          ]);
        },
        { gIdx: generalIdx },
      );
      await page.click("#budget-sub-add");
      await page.waitForFunction(() => document.body.innerText.includes("Manual From UI"));
    } finally {
      await browser.close();
    }
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
