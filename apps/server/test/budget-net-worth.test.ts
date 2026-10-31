import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config";
import { BudgetStore } from "../src/budget/store";

test("budget net worth: sums non-archived balances", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-nw-"));
  const store = BudgetStore.open(dir);
  try {
    const checking = store.createAccount({ name: "Checking", type: "checking", openingBalanceCents: 10000 });
    const credit = store.createAccount({ name: "Card", type: "credit", openingBalanceCents: 0 });
    store.createAccount({ name: "401k", type: "investment", currentBalanceCents: 250000 });
    store.createTransaction({ accountId: checking.id, date: "2026-01-01", amountCents: 5000 });
    store.createTransaction({ accountId: credit.id, date: "2026-01-02", amountCents: -15000 });
    const archived = store.createAccount({ name: "Old", type: "checking", openingBalanceCents: 999900 });
    store.updateAccount(archived.id, { archived: true });
    const nw = store.netWorth();
    assert.equal(nw.totalCents, 10000 + 5000 + -15000 + 250000);
    assert.equal(nw.accounts.length, 3);
    assert.ok(!nw.accounts.some((a) => a.name === "Old"));
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget net worth: investment uses current_balance_cents only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-nw-inv-"));
  const store = BudgetStore.open(dir);
  try {
    const inv = store.createAccount({ name: "Brokerage", type: "investment", currentBalanceCents: 123456 });
    assert.throws(
      () => store.createTransaction({ accountId: inv.id, date: "2026-02-01", amountCents: 999 }),
      /manual balance only/,
    );
    const nw = store.netWorth();
    assert.equal(nw.accounts[0]!.balanceCents, 123456);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget net worth: empty store is zero", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-nw-empty-"));
  const store = BudgetStore.open(dir);
  try {
    assert.equal(store.netWorth().totalCents, 0);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget net worth: negative credit balance included", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-nw-credit-"));
  const store = BudgetStore.open(dir);
  try {
    const card = store.createAccount({ name: "Card", type: "credit", openingBalanceCents: -50000 });
    store.createTransaction({ accountId: card.id, date: "2026-03-01", amountCents: -10000 });
    assert.equal(store.netWorth().totalCents, -60000);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
