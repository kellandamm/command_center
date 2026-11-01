import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { BudgetStore } from "../src/budget/store";
import { BUDGET_DATABASE_FILE } from "../src/budget/constants";
import { BUDGET_MIGRATIONS } from "../src/budget/migrations";
import { transactionFingerprint } from "../src/budget/csv";
import {
  circularDayDistance,
  clusterByAmount,
  computeConfidence,
  detectCandidatesFromCharges,
  runSubscriptionDetection,
  splitBillingDaySublanes,
} from "../src/budget/subscriptions/detect";
import { nextDueDate } from "../src/budget/subscriptions/due";
import type { OutflowCharge } from "../src/budget/subscriptions/types";
import { loadConfig } from "../src/config";

const TZ = "UTC";

function charge(date: string, cents: number, payee: string): OutflowCharge {
  return { date, amountCents: cents, payee, payeeNormalized: payee.toLowerCase() };
}

test("subscriptions detect: month-end next due uses anchor day 31 clamped in February", () => {
  const due = nextDueDate("monthly", "2025-01-31", TZ, "2025-01-31");
  assert.equal(due, "2025-02-28");
  const dueLeap = nextDueDate("monthly", "2024-01-31", TZ, "2024-01-31");
  assert.equal(dueLeap, "2024-02-29");
});

test("subscriptions detect: circular day distance wraps Jan 31 and Feb 1", () => {
  assert.equal(circularDayDistance(31, 1), 1);
});

test("subscriptions detect: Jan 31 and Feb 1 stay one monthly sublane", () => {
  const charges = [charge("2025-01-31", -1000, "svc"), charge("2025-02-01", -1000, "svc")];
  const lanes = splitBillingDaySublanes(charges, "monthly", TZ);
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0]!.length, 2);
});

test("subscriptions detect: weekly lane is not split by billing-day rule", () => {
  const charges = [
    charge("2025-01-06", -500, "gym"),
    charge("2025-01-13", -500, "gym"),
    charge("2025-01-20", -500, "gym"),
  ];
  const lanes = splitBillingDaySublanes(charges, "weekly", TZ);
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0]!.length, 3);
});

test("subscriptions detect: two-charge yearly surfaces as possible_yearly at >= 0.45 confidence", () => {
  const charges = [charge("2023-06-01", -12000, "annual"), charge("2024-06-01", -12000, "annual")];
  const found = detectCandidatesFromCharges(charges, TZ);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.detectionKind, "possible_yearly");
  assert.ok(found[0]!.confidence >= 0.45);
});

test("subscriptions detect: dual Amazon amounts stay two detections", () => {
  const charges: OutflowCharge[] = [];
  for (let m = 1; m <= 6; m++) {
    const mm = String(m).padStart(2, "0");
    charges.push(charge(`2025-${mm}-03`, -1499, "Amazon"));
    charges.push(charge(`2025-${mm}-20`, -1599, "Amazon"));
  }
  const found = detectCandidatesFromCharges(charges, TZ);
  assert.equal(found.length, 2);
  const amounts = found.map((f) => f.amountCents).sort((a, b) => a - b);
  assert.deepEqual(amounts, [-1599, -1499]);
});

test("subscriptions detect: confidence formula one gap yields gapScore 1", () => {
  const charges = [charge("2025-01-01", -999, "x"), charge("2025-01-08", -999, "x"), charge("2025-01-15", -999, "x")];
  const conf = computeConfidence("weekly", [7, 7], charges, 999, "standard");
  assert.ok(conf >= 0.7);
});

test("subscriptions detect: permanent dismiss prevents re-detection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sub-dismiss-"));
  const store = BudgetStore.open(dir);
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const base = new Date();
    const dates = [0, 31, 62].map((offset) => {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() - 180 + offset);
      return d.toISOString().slice(0, 10);
    });
    const rows = dates.map((date, i) => ({
      rowNumber: 2 + i,
      date,
      amountCents: -999,
      payee: "Netflix",
      memo: "",
      categoryId: null,
      fingerprint: transactionFingerprint(acct.id, date, -999, "Netflix", i),
    }));
    store.commitImport({
      accountId: acct.id,
      fileName: "a.csv",
      fileSha256: "x",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD" },
      invertSign: false,
      rows,
    });
    const cfg = loadConfig({
      DATA_DIR: dir,
      CF_ACCESS_TEAM_DOMAIN: "t.example.com",
      CF_ACCESS_AUD: "aud",
      OWNER_EMAILS: "o@example.com",
      TZ: "UTC",
    });
    runSubscriptionDetection(store, cfg);
    const pending = store.listPendingDetections();
    assert.equal(pending.length, 1);
    store.dismissDetection(pending[0]!.id);
    runSubscriptionDetection(store, cfg);
    assert.equal(store.listPendingDetections().length, 0);
    assert.ok(
      store.isDetectionPermanentlyDismissed(pending[0]!.payeeNormalized, pending[0]!.cadence, pending[0]!.amountCents),
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("subscriptions detect: volume scan uses SQL lookback and completes quickly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sub-volume-"));
  const store = BudgetStore.open(dir);
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const start = Date.now();
    const now = new Date();
    for (let i = 0; i < 5000; i++) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - (i % 400));
      const date = d.toISOString().slice(0, 10);
      store.createTransaction({
        accountId: acct.id,
        date,
        amountCents: -100 - (i % 50),
        payee: `Merchant ${i % 40}`,
      });
    }
    const cfg = loadConfig({
      DATA_DIR: dir,
      CF_ACCESS_TEAM_DOMAIN: "t.example.com",
      CF_ACCESS_AUD: "aud",
      OWNER_EMAILS: "o@example.com",
      TZ: "UTC",
    });
    const result = runSubscriptionDetection(store, cfg);
    const elapsed = Date.now() - start;
    assert.ok(result.scanned >= 3000);
    assert.ok(elapsed < 30_000, `scan took ${elapsed}ms`);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget migration v2 to v3 preserves existing data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-mig3-"));
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, BUDGET_DATABASE_FILE);
  const db = new DatabaseSync(dbPath);
  db.exec(BUDGET_MIGRATIONS[0]!.sql);
  db.exec(BUDGET_MIGRATIONS[1]!.sql);
  db.prepare("INSERT INTO schema_version (version, description, applied_at) VALUES (1, 'core', 't')").run();
  db.prepare("INSERT INTO schema_version (version, description, applied_at) VALUES (2, 'prefs', 't')").run();
  const gid = "g1";
  db.prepare("INSERT INTO category_groups (id, name, position, is_income) VALUES (?, 'Food', 0, 0)").run(gid);
  db.prepare("INSERT INTO categories (id, group_id, name, position) VALUES ('c1', ?, 'Groceries', 0)").run(gid);
  db.prepare(
    `INSERT INTO accounts (id, name, type, opening_balance_cents, invert_sign, currency, archived, created_at, updated_at)
     VALUES ('a1', 'Checking', 'checking', 0, 0, 'USD', 0, 't', 't')`,
  ).run();
  db.prepare(
    `INSERT INTO transactions (id, account_id, date, amount_cents, payee, memo, cleared, created_at, updated_at)
     VALUES ('t1', 'a1', '2025-01-01', -100, 'Test Payee', '', 1, 't', 't')`,
  ).run();
  db.close();

  const store = BudgetStore.open(dir);
  try {
    assert.ok(existsSync(dbPath));
    assert.equal(store.listAccounts().length, 1);
    assert.equal(store.listTransactions().length, 1);
    assert.equal(store.listCategories().length, 1);
    const tables = new DatabaseSync(dbPath)
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('subscriptions','subscription_detections')")
      .all() as { name: string }[];
    assert.equal(tables.length, 2);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("subscriptions detect: dismissed 10.00 band stays dismissed after 10.40 charges", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sub-1040-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({
    DATA_DIR: dir,
    CF_ACCESS_TEAM_DOMAIN: "t.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: "o@example.com",
    TZ: "UTC",
  });
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const base = new Date();
    const mk = (offset: number, cents: number, i: number) => {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() - 120 + offset);
      const date = d.toISOString().slice(0, 10);
      return {
        rowNumber: 2 + i,
        date,
        amountCents: cents,
        payee: "Utility Co",
        memo: "",
        categoryId: null,
        fingerprint: transactionFingerprint(acct.id, date, cents, "Utility Co", i),
      };
    };
    store.commitImport({
      accountId: acct.id,
      fileName: "a.csv",
      fileSha256: "x",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD" },
      invertSign: false,
      rows: [mk(0, -1000, 0), mk(31, -1000, 1), mk(62, -1040, 2)],
    });
    runSubscriptionDetection(store, cfg);
    const pending = store.listPendingDetections();
    assert.equal(pending.length, 1);
    store.dismissDetection(pending[0]!.id);
    store.commitImport({
      accountId: acct.id,
      fileName: "b.csv",
      fileSha256: "y",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD" },
      invertSign: false,
      rows: [mk(93, -1040, 3), mk(124, -1040, 4)],
    });
    runSubscriptionDetection(store, cfg);
    assert.equal(store.listPendingDetections().length, 0);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("subscriptions detect: dismissed weekly stays dismissed at 9 and 40 charges", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sub-weekly-id-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({
    DATA_DIR: dir,
    CF_ACCESS_TEAM_DOMAIN: "t.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: "o@example.com",
    TZ: "UTC",
  });
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 200);
    const rows = [];
    for (let i = 0; i < 40; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i * 7);
      const date = d.toISOString().slice(0, 10);
      rows.push({
        rowNumber: 2 + i,
        date,
        amountCents: -500,
        payee: "Gym Weekly",
        memo: "",
        categoryId: null,
        fingerprint: transactionFingerprint(acct.id, date, -500, "Gym Weekly", i),
      });
    }
    store.commitImport({
      accountId: acct.id,
      fileName: "g.csv",
      fileSha256: "g",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD" },
      invertSign: false,
      rows: rows.slice(0, 3),
    });
    runSubscriptionDetection(store, cfg);
    const pending = store.listPendingDetections();
    assert.equal(pending.length, 1);
    store.dismissDetection(pending[0]!.id);
    store.commitImport({
      accountId: acct.id,
      fileName: "g2.csv",
      fileSha256: "g2",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD" },
      invertSign: false,
      rows: rows.slice(3, 9),
    });
    runSubscriptionDetection(store, cfg);
    assert.equal(store.listPendingDetections().length, 0);
    store.commitImport({
      accountId: acct.id,
      fileName: "g3.csv",
      fileSha256: "g3",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD" },
      invertSign: false,
      rows: rows.slice(9, 40),
    });
    runSubscriptionDetection(store, cfg);
    assert.equal(store.listPendingDetections().length, 0);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("subscriptions detect: rescan does not duplicate pending row", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sub-dup-pending-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({
    DATA_DIR: dir,
    CF_ACCESS_TEAM_DOMAIN: "t.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: "o@example.com",
    TZ: "UTC",
  });
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const base = new Date();
    const rows = [0, 31, 62].map((offset, i) => {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() - 90 + offset);
      const date = d.toISOString().slice(0, 10);
      return {
        rowNumber: 2 + i,
        date,
        amountCents: -999,
        payee: "Spotify",
        memo: "",
        categoryId: null,
        fingerprint: transactionFingerprint(acct.id, date, -999, "Spotify", i),
      };
    });
    store.commitImport({
      accountId: acct.id,
      fileName: "s.csv",
      fileSha256: "s",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD" },
      invertSign: false,
      rows,
    });
    runSubscriptionDetection(store, cfg);
    runSubscriptionDetection(store, cfg);
    assert.equal(store.listPendingDetections().length, 1);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("subscriptions detect: confirmed Netflix band suppresses same price but not price hike", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sub-netflix-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({
    DATA_DIR: dir,
    CF_ACCESS_TEAM_DOMAIN: "t.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: "o@example.com",
    TZ: "UTC",
  });
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const cat = store.listCategories().find((c) => c.name === "Streaming")!.id;
    store.createSubscriptionManual({
      displayName: "Netflix",
      payee: "NETFLIX.COM",
      amountCents: -1549,
      cadence: "monthly",
      anchorDate: "2025-01-05",
      categoryId: cat,
    });
    const base = new Date();
    const rows = [0, 31, 62, 93].map((offset, i) => {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() - 120 + offset);
      const date = d.toISOString().slice(0, 10);
      return {
        rowNumber: 2 + i,
        date,
        amountCents: -1799,
        payee: "NETFLIX.COM",
        memo: "",
        categoryId: null,
        fingerprint: transactionFingerprint(acct.id, date, -1799, "NETFLIX.COM", i),
      };
    });
    store.commitImport({
      accountId: acct.id,
      fileName: "n.csv",
      fileSha256: "n",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD" },
      invertSign: false,
      rows,
    });
    runSubscriptionDetection(store, cfg);
    const pending = store.listPendingDetections();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.amountCents, -1799);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("subscriptions detect: confirming one Amazon amount still surfaces the other", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sub-amazon-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({
    DATA_DIR: dir,
    CF_ACCESS_TEAM_DOMAIN: "t.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: "o@example.com",
    TZ: "UTC",
  });
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const cat = store.listCategories().find((c) => c.name === "General")!.id;
    const base = new Date();
    const rows: Parameters<BudgetStore["commitImport"]>[0]["rows"] = [];
    for (let m = 0; m < 4; m++) {
      const dLow = new Date(base);
      dLow.setUTCDate(dLow.getUTCDate() - 120 + m * 31);
      const dHigh = new Date(dLow);
      dHigh.setUTCDate(dHigh.getUTCDate() + 17);
      const dateLow = dLow.toISOString().slice(0, 10);
      const dateHigh = dHigh.toISOString().slice(0, 10);
      rows.push({
        rowNumber: rows.length + 2,
        date: dateLow,
        amountCents: -1499,
        payee: "Amazon",
        memo: "",
        categoryId: null,
        fingerprint: transactionFingerprint(acct.id, dateLow, -1499, "Amazon", rows.length),
      });
      rows.push({
        rowNumber: rows.length + 2,
        date: dateHigh,
        amountCents: -1599,
        payee: "Amazon",
        memo: "",
        categoryId: null,
        fingerprint: transactionFingerprint(acct.id, dateHigh, -1599, "Amazon", rows.length + 1),
      });
    }
    store.commitImport({
      accountId: acct.id,
      fileName: "a.csv",
      fileSha256: "a",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD" },
      invertSign: false,
      rows,
    });
    runSubscriptionDetection(store, cfg);
    const firstPass = store.listPendingDetections();
    assert.equal(firstPass.length, 2);
    const low = firstPass.find((d) => d.amountCents === -1499)!;
    store.confirmDetection(low.id, { categoryId: cat });
    runSubscriptionDetection(store, cfg);
    const secondPass = store.listPendingDetections();
    assert.equal(secondPass.length, 1);
    assert.equal(secondPass[0]!.amountCents, -1599);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("subscriptions detect: deactivated subscription still suppresses its amount band", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sub-deact-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({
    DATA_DIR: dir,
    CF_ACCESS_TEAM_DOMAIN: "t.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: "o@example.com",
    TZ: "UTC",
  });
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const cat = store.listCategories().find((c) => c.name === "Streaming")!.id;
    const sub = store.createSubscriptionManual({
      displayName: "Spotify",
      payee: "Spotify",
      amountCents: -999,
      cadence: "monthly",
      anchorDate: "2025-01-01",
      categoryId: cat,
    });
    store.updateSubscription(sub.id, { active: false });
    const base = new Date();
    const rows = [0, 31, 62].map((offset, i) => {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() - 90 + offset);
      const date = d.toISOString().slice(0, 10);
      return {
        rowNumber: 2 + i,
        date,
        amountCents: -999,
        payee: "Spotify",
        memo: "",
        categoryId: null,
        fingerprint: transactionFingerprint(acct.id, date, -999, "Spotify", i),
      };
    });
    store.commitImport({
      accountId: acct.id,
      fileName: "s.csv",
      fileSha256: "s",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD" },
      invertSign: false,
      rows,
    });
    runSubscriptionDetection(store, cfg);
    assert.equal(store.listPendingDetections().length, 0);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("subscriptions detect: active subscription amount syncs from latest in-band charge", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sub-sync-amt-"));
  const store = BudgetStore.open(dir);
  const cfg = loadConfig({
    DATA_DIR: dir,
    CF_ACCESS_TEAM_DOMAIN: "t.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: "o@example.com",
    TZ: "UTC",
  });
  try {
    const acct = store.createAccount({ name: "Checking", type: "checking" });
    const cat = store.listCategories().find((c) => c.name === "Electric")!.id;
    const sub = store.createSubscriptionManual({
      displayName: "Utility Co",
      payee: "Utility Co",
      amountCents: -1000,
      cadence: "monthly",
      anchorDate: "2025-01-01",
      categoryId: cat,
    });
    const base = new Date();
    const rows = [0, 31, 62].map((offset, i) => {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() - 90 + offset);
      const date = d.toISOString().slice(0, 10);
      return {
        rowNumber: 2 + i,
        date,
        amountCents: -1040,
        payee: "Utility Co",
        memo: "",
        categoryId: null,
        fingerprint: transactionFingerprint(acct.id, date, -1040, "Utility Co", i),
      };
    });
    store.commitImport({
      accountId: acct.id,
      fileName: "u.csv",
      fileSha256: "u",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD" },
      invertSign: false,
      rows,
    });
    runSubscriptionDetection(store, cfg);
    const updated = store.getSubscription(sub.id)!;
    assert.equal(updated.amountCents, -1040);
    assert.equal(store.listPendingDetections().length, 0);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("subscriptions detect: clusterByAmount separates close amounts", () => {
  const clusters = clusterByAmount([
    charge("2025-01-01", -1499, "a"),
    charge("2025-02-01", -1499, "a"),
    charge("2025-01-01", -1599, "a"),
  ]);
  assert.equal(clusters.length, 2);
});
