import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config";
import { BudgetStore } from "../src/budget/store";
import { computeRollup, monthKey } from "../src/budget/rollup";

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
    assert.equal(rollup.cashFlowCents, rollup.incomeCents + rollup.spendCents);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget rollup: month boundaries use cfg.tz", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-rollup-tz-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({ TZ: "America/New_York" });
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const food = foodCategoryId(store);
    store.createTransaction({ accountId: acct.id, date: "2026-02-28", amountCents: -100, categoryId: food });
    store.createTransaction({ accountId: acct.id, date: "2026-03-01", amountCents: -200, categoryId: food });
    const feb = computeRollup(store, cfg, "2026-02");
    const mar = computeRollup(store, cfg, "2026-03");
    assert.equal(feb.spendCents, -100);
    assert.equal(mar.spendCents, -200);
    const nowMonth = monthKey(new Date("2026-03-15T12:00:00Z"), cfg.tz);
    assert.equal(nowMonth, "2026-03");
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
    assert.ok(Array.isArray(rollup.byCategory));
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
    const row = rollup.byCategory.find((r) => r.categoryId === food)!;
    assert.equal(row.budgetedCents, 30000);
    assert.equal(row.spentCents, -12000);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
