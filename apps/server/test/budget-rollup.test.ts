import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config";
import { dayKey } from "../src/store";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { SettingsStore } from "../src/settings";
import { NotesStore } from "../src/notes/store";
import { BudgetStore } from "../src/budget/store";
import {
  BUDGET_ROLLUP_TX_LIMIT,
  computeRollup,
  monthKey,
  sumCategorySpentCents,
  topSpendingCategoryRows,
} from "../src/budget/rollup";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

function incomeCategoryId(store: BudgetStore): string {
  const groups = store.listCategoryGroups();
  const incomeGroup = groups.find((g) => g.isIncome)!;
  return store.listCategories().find((c) => c.groupId === incomeGroup.id)!.id;
}

function foodCategoryId(store: BudgetStore): string {
  return store.listCategories().find((c) => c.name === "Groceries")!.id;
}

test("budget rollup: excludes transfers from spend totals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-rollup-tx-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({ TZ: "UTC" });
  try {
    const checking = store.createAccount({ name: "Checking", type: "checking" });
    const savings = store.createAccount({ name: "Savings", type: "savings" });
    const food = foodCategoryId(store);
    store.createTransaction({ accountId: checking.id, date: "2026-03-10", amountCents: -5000, categoryId: food });
    store.createTransaction({
      accountId: checking.id,
      date: "2026-03-11",
      amountCents: -10000,
      payee: "Transfer",
      transferAccountId: savings.id,
    });
    const rollup = computeRollup(store, cfg, "2026-03");
    assert.equal(rollup.spendCents, -5000);
    assert.equal(rollup.spendCents, sumCategorySpentCents(rollup.byCategory));
    assert.equal(rollup.cashFlowCents, rollup.incomeCents + rollup.spendCents);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget rollup: month boundary uses cfg.tz at end of month evening", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-rollup-tz-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({ TZ: "America/Chicago" });
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const food = foodCategoryId(store);
    const edge = new Date("2026-02-01T05:30:00.000Z");
    const txDate = dayKey(edge, cfg.tz);
    assert.equal(txDate, "2026-01-31");
    store.createTransaction({ accountId: acct.id, date: txDate, amountCents: -999, categoryId: food });
    const jan = computeRollup(store, cfg, "2026-01");
    const feb = computeRollup(store, cfg, "2026-02");
    assert.equal(jan.spendCents, -999);
    assert.equal(feb.spendCents, 0);
    const nowMonth = monthKey(new Date("2026-02-15T12:00:00Z"), cfg.tz);
    assert.equal(nowMonth, "2026-02");
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget rollup: empty store returns zero rollup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-rollup-empty-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({ TZ: "UTC" });
  try {
    const rollup = computeRollup(store, cfg, "2026-01");
    assert.equal(rollup.incomeCents, 0);
    assert.equal(rollup.spendCents, 0);
    assert.equal(rollup.cashFlowCents, 0);
    assert.deepEqual(rollup.topCategories, []);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget rollup: income vs spend and budgeted amounts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-rollup-inc-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({ TZ: "UTC" });
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const food = foodCategoryId(store);
    const income = incomeCategoryId(store);
    store.setBudgetMonth("2026-04", food, 30000);
    store.createTransaction({ accountId: acct.id, date: "2026-04-05", amountCents: 500000, categoryId: income });
    store.createTransaction({ accountId: acct.id, date: "2026-04-06", amountCents: -12000, categoryId: food });
    const rollup = computeRollup(store, cfg, "2026-04");
    assert.equal(rollup.incomeCents, 500000);
    assert.equal(rollup.spendCents, -12000);
    assert.equal(rollup.spendCents, sumCategorySpentCents(rollup.byCategory));
    const row = rollup.byCategory.find((r) => r.categoryId === food)!;
    assert.equal(row.budgetedCents, 30000);
    assert.equal(row.spentCents, -12000);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget rollup: uncategorized inflow counts as income", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-rollup-uncat-in-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({ TZ: "UTC" });
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    store.createTransaction({ accountId: acct.id, date: "2026-05-01", amountCents: 2500, payee: "Mystery deposit" });
    const rollup = computeRollup(store, cfg, "2026-05");
    assert.equal(rollup.incomeCents, 2500);
    assert.equal(rollup.spendCents, 0);
    assert.equal(rollup.cashFlowCents, 2500);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget rollup: categorized refund reduces spend and category totals consistently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-rollup-refund-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({ TZ: "UTC" });
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const food = foodCategoryId(store);
    store.createTransaction({ accountId: acct.id, date: "2026-05-10", amountCents: -5844, categoryId: food });
    store.createTransaction({ accountId: acct.id, date: "2026-05-12", amountCents: 700, categoryId: food, payee: "Refund" });
    const rollup = computeRollup(store, cfg, "2026-05");
    assert.equal(rollup.spendCents, -5144);
    assert.equal(rollup.spendCents, sumCategorySpentCents(rollup.byCategory));
    const row = rollup.byCategory.find((r) => r.categoryId === food)!;
    assert.equal(row.spentCents, -5144);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget rollup: top categories sorted by largest spend first", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-rollup-top-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({ TZ: "UTC" });
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const food = foodCategoryId(store);
    const dining = store.listCategories().find((c) => c.name === "Dining")!.id;
    store.createTransaction({ accountId: acct.id, date: "2026-06-01", amountCents: -100, categoryId: dining });
    store.createTransaction({ accountId: acct.id, date: "2026-06-02", amountCents: -5000, categoryId: food });
    const rollup = computeRollup(store, cfg, "2026-06");
    assert.equal(rollup.topCategories.length, 2);
    assert.equal(rollup.topCategories[0]!.categoryId, food);
    assert.equal(rollup.topCategories[1]!.categoryId, dining);
    assert.deepEqual(rollup.topCategories, topSpendingCategoryRows(rollup.byCategory));
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget rollup: scans more than legacy 5000 tx cap", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-rollup-many-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({ TZ: "UTC" });
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const food = foodCategoryId(store);
    const month = "2026-07";
    for (let i = 0; i < 6000; i++) {
      store.createTransaction({
        accountId: acct.id,
        date: `${month}-15`,
        amountCents: -1,
        categoryId: food,
        payee: `Row ${i}`,
      });
    }
    const rollup = computeRollup(store, cfg, month);
    assert.equal(rollup.spendCents, -6000);
    assert.ok(BUDGET_ROLLUP_TX_LIMIT > 6000);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget panel: matches rollup for large month including transfer exclusion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-panel-roll-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: "1",
    CF_ACCESS_TEAM_DOMAIN: "team.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: "owner@example.com",
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const budget = BudgetStore.open(dir);
  const checking = budget.createAccount({ name: "Checking", type: "checking" });
  const savings = budget.createAccount({ name: "Savings", type: "savings" });
  const food = budget.listCategories().find((c) => c.name === "Groceries")!.id;
  const month = monthKey(new Date(), cfg.tz);
  for (let i = 0; i < 6000; i++) {
    budget.createTransaction({ accountId: checking.id, date: `${month}-10`, amountCents: -1, categoryId: food });
  }
  budget.createTransaction({
    accountId: checking.id,
    date: `${month}-11`,
    amountCents: -999999,
    transferAccountId: savings.id,
  });
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async () => ({ email: "owner@example.com" })),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const panel = await fetch(`${base}/api/panels/budget`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    const rollup = await fetch(`${base}/api/budget/rollup?month=${encodeURIComponent(month)}`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    const p = (await panel.json()) as { spendCents: number; cashFlowCents: number };
    const r = (await rollup.json()) as { rollup: { spendCents: number; cashFlowCents: number } };
    assert.equal(p.spendCents, -6000);
    assert.equal(p.spendCents, r.rollup.spendCents);
    assert.equal(p.cashFlowCents, r.rollup.cashFlowCents);
  } finally {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
