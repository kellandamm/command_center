import { test } from "node:test";
import assert from "node:assert/strict";
import util from "node:util";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
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
import { budgetPanelDashboardCss } from "../src/panels/budget";
import { dashboardPage } from "../src/ui/dashboard-page";
import { neutralizeSpreadsheetCell } from "../src/budget/csv-export";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const OWNER = "owner@example.com";

async function openOwnerBudgetHttp() {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-guards-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: "1",
    CF_ACCESS_TEAM_DOMAIN: "team.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: OWNER,
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const budget = BudgetStore.open(dir);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async () => ({ email: OWNER })),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, budget, close };
}

test("budget guard: CSV export uses Cache-Control no-store", async () => {
  const h = await openOwnerBudgetHttp();
  try {
    const res = await fetch(`${h.base}/api/budget/export.csv`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get("cache-control")), /no-store/);
  } finally {
    await h.close();
  }
});

test("budget guard: non-owner dashboard HTML omits budget panel (showBudgetPanel gate)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-guards-dash-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: "1",
    CF_ACCESS_TEAM_DOMAIN: "team.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: OWNER,
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const budget = BudgetStore.open(dir);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async () => ({ email: "guest@example.com" })),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/`, { headers: { cookie: "CF_Authorization=t", "x-ah": "1" } });
    const html = await res.text();
    assert.ok(!html.includes('data-panel-id="budget"'));
    assert.ok(!html.includes("loadBudgetPanel"));
  } finally {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
  assert.ok(!dashboardPage([], { showBudgetPanel: false }).includes('data-panel-id="budget"'));
});

test("budget guard: dashboard blur uses CSS filter, not class name alone", () => {
  const css = budgetPanelDashboardCss();
  assert.match(css, /filter:\s*blur\(/);
});

test("budget guard: budget-months PUT rejects empty or income category id", async () => {
  const h = await openOwnerBudgetHttp();
  try {
    const income = h.budget.listCategories().find((c) => c.name === "Paycheck")!.id;
    const food = h.budget.listCategories().find((c) => c.name === "Groceries")!.id;
    const empty = await fetch(`${h.base}/api/budget/budget-months`, {
      method: "PUT",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", "x-ah": "1" },
      body: JSON.stringify({ month: "2026-03", categoryId: "", budgetedCents: 100 }),
    });
    assert.equal(empty.status, 400);
    const badIncome = await fetch(`${h.base}/api/budget/budget-months`, {
      method: "PUT",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", "x-ah": "1" },
      body: JSON.stringify({ month: "2026-03", categoryId: income, budgetedCents: 100 }),
    });
    assert.equal(badIncome.status, 400);
    const ok = await fetch(`${h.base}/api/budget/budget-months`, {
      method: "PUT",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", "x-ah": "1" },
      body: JSON.stringify({ month: "2026-03", categoryId: food, budgetedCents: 100 }),
    });
    assert.equal(ok.status, 200);
  } finally {
    await h.close();
  }
});

test("budget guard: validation errors log via logBudgetError", async () => {
  const h = await openOwnerBudgetHttp();
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    const acct = h.budget.createAccount({ name: "Checking", type: "checking" });
    const res = await fetch(`${h.base}/api/budget/transactions`, {
      method: "POST",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", "x-ah": "1" },
      body: JSON.stringify({ accountId: acct.id, date: "2026-01-01", amountCents: 1.5 }),
    });
    assert.equal(res.status, 400);
    const blob = util.inspect(errors, { depth: 5 });
    assert.match(blob, /validation/);
    assert.ok(!blob.includes("amount must be whole cents"));
  } finally {
    console.error = orig;
    await h.close();
  }
});

test("budget guard: route catch logs via logBudgetError without leaking err text", async () => {
  const h = await openOwnerBudgetHttp();
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    (h.budget as BudgetStore & { deleteAllData: () => void }).deleteAllData = () => {
      throw new Error("SECRET_GUARD_PAYEE");
    };
    const res = await fetch(`${h.base}/api/budget/delete-all`, {
      method: "POST",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", "x-ah": "1" },
      body: JSON.stringify({ confirm: "DELETE ALL BUDGET DATA" }),
    });
    assert.equal(res.status, 500);
    const blob = JSON.stringify(errors);
    assert.ok(!blob.includes("SECRET_GUARD_PAYEE"));
    assert.match(blob, /budget:/);
  } finally {
    console.error = orig;
    await h.close();
  }
});

test("budget guard: delete-all requires exact confirmation phrase", async () => {
  const h = await openOwnerBudgetHttp();
  try {
    h.budget.createAccount({ name: "Keep", type: "checking" });
    const bad = await fetch(`${h.base}/api/budget/delete-all`, {
      method: "POST",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", "x-ah": "1" },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    assert.equal(bad.status, 400);
    assert.equal(h.budget.listAccounts().length, 1);
  } finally {
    await h.close();
  }
});

test("budget guard: CSV export includes account_name on transactions", async () => {
  const h = await openOwnerBudgetHttp();
  try {
    const acct = h.budget.createAccount({ name: "Primary Checking", type: "checking" });
    h.budget.createTransaction({ accountId: acct.id, date: "2026-01-02", amountCents: -100 });
    const res = await fetch(`${h.base}/api/budget/export.csv`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    const text = await res.text();
    assert.match(text, /transaction,[^,]+,[^,]+,"Primary Checking"/);
  } finally {
    await h.close();
  }
});

test("budget guard: CSV export neutralizes spreadsheet formulas", () => {
  assert.equal(neutralizeSpreadsheetCell("=cmd|"), "'=cmd|");
  assert.equal(neutralizeSpreadsheetCell("safe"), "safe");
});

test("budget guard: invalid rollup month returns 400", async () => {
  const h = await openOwnerBudgetHttp();
  try {
    const res = await fetch(`${h.base}/api/budget/rollup?month=2026-13`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    assert.equal(res.status, 400);
  } finally {
    await h.close();
  }
});
