import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { BudgetStore } from "../src/budget/store";
import { BUDGET_DATABASE_FILE } from "../src/budget/constants";
import { transactionFingerprint } from "../src/budget/csv";

test("budget store: seeds categories and persists accounts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-store-"));
  const store = BudgetStore.open(dir);
  try {
    assert.ok(existsSync(join(dir, BUDGET_DATABASE_FILE)));
    assert.ok(store.listCategoryGroups().length >= 5);
    const acct = store.createAccount({ name: "Checking", type: "checking", openingBalanceCents: 100_00 });
    assert.equal(acct.openingBalanceCents, 100_00);
    assert.equal(store.listAccounts().length, 1);
    const inv = store.createAccount({ name: "401k", type: "investment", currentBalanceCents: 50_000_00 });
    assert.equal(inv.currentBalanceCents, 50_000_00);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget store: fingerprint dedupe skips existing row", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-fp-"));
  const store = BudgetStore.open(dir);
  try {
    const acct = store.createAccount({ name: "Card", type: "credit" });
    const fp = transactionFingerprint(acct.id, "2026-01-15", -4500, "Coffee Shop", 0);
    store.commitImport({
      accountId: acct.id,
      fileName: "a.csv",
      fileSha256: "abc",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD" },
      invertSign: false,
      rows: [
        {
          rowNumber: 2,
          date: "2026-01-15",
          amountCents: -4500,
          payee: "Coffee Shop",
          memo: "",
          categoryId: null,
          fingerprint: fp,
        },
      ],
    });
    assert.equal(store.listTransactions(acct.id).length, 1);
    const batch2 = store.commitImport({
      accountId: acct.id,
      fileName: "a.csv",
      fileSha256: "abc",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD" },
      invertSign: false,
      rows: [
        {
          rowNumber: 2,
          date: "2026-01-15",
          amountCents: -4500,
          payee: "Coffee Shop",
          memo: "",
          categoryId: null,
          fingerprint: fp,
        },
      ],
    });
    assert.equal(batch2.rowsAdded, 0);
    assert.equal(store.listTransactions(acct.id).length, 1);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget store: undo import cascades transactions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-undo-"));
  const store = BudgetStore.open(dir);
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const fp = transactionFingerprint(acct.id, "2026-02-01", -100, "Test", 0);
    const batch = store.commitImport({
      accountId: acct.id,
      fileName: "b.csv",
      fileSha256: "def",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD" },
      invertSign: false,
      rows: [
        {
          rowNumber: 2,
          date: "2026-02-01",
          amountCents: -100,
          payee: "Test",
          memo: "",
          categoryId: null,
          fingerprint: fp,
        },
      ],
    });
    assert.equal(store.listTransactions(acct.id).length, 1);
    store.undoImport(batch.id);
    assert.equal(store.listTransactions(acct.id).length, 0);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
