import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ValidationError } from "../settings";
import type { AccountType } from "./constants";
import { ACCOUNT_TYPES, BUDGET_IMPORT_MAX_ROWS } from "./constants";
import type { CsvMapping, NormalizedImportRow } from "./csv";
import { normalizePayee } from "./csv";
import { openBudgetDatabase } from "./db";
import type { SubscriptionCadence, SubscriptionDetectionRow, SubscriptionRow, SubscriptionSource } from "./subscriptions/types";
import { amountInCluster } from "./subscriptions/detect";
import { annualCostCents, nextDueDate, requireValidIsoDate, safeNextDueDate } from "./subscriptions/due";

const BUDGET_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Inclusive calendar date bounds for a budget month (YYYY-MM) in stored date strings. */
export function monthDateBounds(month: string): { start: string; end: string } {
  if (!BUDGET_MONTH_RE.test(month)) throw new ValidationError("invalid month");
  const [y, mo] = month.split("-").map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(Date.UTC(y!, mo!, 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export interface BudgetAccount {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  last4: string | null;
  openingBalanceCents: number;
  openingDate: string | null;
  currentBalanceCents: number | null;
  invertSign: boolean;
  currency: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetCategory {
  id: string;
  groupId: string;
  name: string;
  position: number;
  archived: boolean;
}

export interface BudgetCategoryGroup {
  id: string;
  name: string;
  position: number;
  isIncome: boolean;
}

export interface BudgetTransaction {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  payee: string;
  memo: string;
  categoryId: string | null;
  transferAccountId: string | null;
  cleared: boolean;
  importBatchId: string | null;
  fingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportBatch {
  id: string;
  accountId: string;
  fileName: string | null;
  fileSha256: string;
  rowsTotal: number;
  rowsAdded: number;
  rowsSkipped: number;
  mappingJson: string;
  createdAt: string;
  undoneAt: string | null;
}

const DEFAULT_CATEGORIES: Array<{ group: string; isIncome?: boolean; categories: string[] }> = [
  { group: "Housing", categories: ["Rent/Mortgage", "Maintenance"] },
  { group: "Utilities", categories: ["Electric", "Gas", "Water", "Internet"] },
  { group: "Food", categories: ["Groceries", "Dining"] },
  { group: "Transport", categories: ["Fuel", "Transit", "Parking"] },
  { group: "Health", categories: ["Medical", "Pharmacy"] },
  { group: "Subscriptions", categories: ["Streaming", "Software"] },
  { group: "Shopping", categories: ["General"] },
  { group: "Travel", categories: ["Trips"] },
  { group: "Gifts", categories: ["Gifts"] },
  { group: "Savings", categories: ["Transfer to savings"] },
  { group: "Income", isIncome: true, categories: ["Paycheck", "Other income"] },
];

function rowAccount(r: Record<string, unknown>): BudgetAccount {
  return {
    id: String(r.id),
    name: String(r.name),
    type: String(r.type) as AccountType,
    institution: r.institution == null ? null : String(r.institution),
    last4: r.last4 == null ? null : String(r.last4),
    openingBalanceCents: Number(r.opening_balance_cents),
    openingDate: r.opening_date == null ? null : String(r.opening_date),
    currentBalanceCents: r.current_balance_cents == null ? null : Number(r.current_balance_cents),
    invertSign: Boolean(r.invert_sign),
    currency: String(r.currency ?? "USD"),
    archived: Boolean(r.archived),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowTx(r: Record<string, unknown>): BudgetTransaction {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    date: String(r.date),
    amountCents: Number(r.amount_cents),
    payee: String(r.payee ?? ""),
    memo: String(r.memo ?? ""),
    categoryId: r.category_id == null ? null : String(r.category_id),
    transferAccountId: r.transfer_account_id == null ? null : String(r.transfer_account_id),
    cleared: Boolean(r.cleared),
    importBatchId: r.import_batch_id == null ? null : String(r.import_batch_id),
    fingerprint: r.fingerprint == null ? null : String(r.fingerprint),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export class BudgetStore {
  private constructor(private db: DatabaseSync) {}

  static open(dataDir: string): BudgetStore {
    const db = openBudgetDatabase(dataDir);
    const store = new BudgetStore(db);
    store.seedDefaultsIfEmpty();
    return store;
  }

  close(): void {
    this.db.close();
  }

  private seedDefaultsIfEmpty(): void {
    const n = this.db.prepare("SELECT COUNT(*) AS c FROM category_groups").get() as { c: number };
    if (Number(n.c) > 0) return;
    const now = new Date().toISOString();
    let gPos = 0;
    for (const block of DEFAULT_CATEGORIES) {
      const gid = randomUUID();
      this.db
        .prepare("INSERT INTO category_groups (id, name, position, is_income) VALUES (?, ?, ?, ?)")
        .run(gid, block.group, gPos++, block.isIncome ? 1 : 0);
      block.categories.forEach((name, i) => {
        this.db.prepare("INSERT INTO categories (id, group_id, name, position) VALUES (?, ?, ?, ?)").run(randomUUID(), gid, name, i);
      });
    }
    void now;
  }

  listAccounts(includeArchived = false): BudgetAccount[] {
    const rows = this.db
      .prepare(`SELECT * FROM accounts ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY name`)
      .all() as Record<string, unknown>[];
    return rows.map(rowAccount);
  }

  getAccount(id: string): BudgetAccount | undefined {
    const r = this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return r ? rowAccount(r) : undefined;
  }

  createAccount(input: {
    name: string;
    type: AccountType;
    institution?: string;
    last4?: string;
    openingBalanceCents?: number;
    openingDate?: string;
    currentBalanceCents?: number;
    invertSign?: boolean;
  }): BudgetAccount {
    const name = String(input.name).trim().slice(0, 120);
    if (!name) throw new ValidationError("Account name is required");
    if (!ACCOUNT_TYPES.includes(input.type)) throw new ValidationError("Invalid account type");
    if (input.last4 != null && !/^\d{4}$/.test(input.last4)) throw new ValidationError("last4 must be four digits");
    const now = new Date().toISOString();
    const id = randomUUID();
    const current =
      input.type === "investment"
        ? (input.currentBalanceCents ?? input.openingBalanceCents ?? 0)
        : null;
    this.db
      .prepare(
        `INSERT INTO accounts (id, name, type, institution, last4, opening_balance_cents, opening_date, current_balance_cents, invert_sign, currency, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', 0, ?, ?)`,
      )
      .run(
        id,
        name,
        input.type,
        input.institution?.trim().slice(0, 120) ?? null,
        input.last4 ?? null,
        input.openingBalanceCents ?? 0,
        input.openingDate ?? null,
        current,
        input.invertSign ? 1 : 0,
        now,
        now,
      );
    return this.getAccount(id)!;
  }

  updateAccount(
    id: string,
    patch: Partial<{
      name: string;
      institution: string | null;
      last4: string | null;
      openingBalanceCents: number;
      openingDate: string | null;
      currentBalanceCents: number;
      invertSign: boolean;
      archived: boolean;
    }>,
  ): BudgetAccount | undefined {
    const cur = this.getAccount(id);
    if (!cur) return undefined;
    const now = new Date().toISOString();
    const name = patch.name !== undefined ? String(patch.name).trim().slice(0, 120) : cur.name;
    if (!name) throw new ValidationError("Account name is required");
    if (patch.last4 != null && patch.last4 !== "" && !/^\d{4}$/.test(patch.last4)) {
      throw new ValidationError("last4 must be four digits");
    }
    this.db
      .prepare(
        `UPDATE accounts SET name = ?, institution = ?, last4 = ?, opening_balance_cents = ?, opening_date = ?,
         current_balance_cents = ?, invert_sign = ?, archived = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        name,
        patch.institution !== undefined ? patch.institution : cur.institution,
        patch.last4 !== undefined ? patch.last4 : cur.last4,
        patch.openingBalanceCents ?? cur.openingBalanceCents,
        patch.openingDate !== undefined ? patch.openingDate : cur.openingDate,
        patch.currentBalanceCents !== undefined ? patch.currentBalanceCents : cur.currentBalanceCents,
        patch.invertSign !== undefined ? (patch.invertSign ? 1 : 0) : cur.invertSign ? 1 : 0,
        patch.archived !== undefined ? (patch.archived ? 1 : 0) : cur.archived ? 1 : 0,
        now,
        id,
      );
    return this.getAccount(id);
  }

  listCategoryGroups(): BudgetCategoryGroup[] {
    return (this.db.prepare("SELECT * FROM category_groups ORDER BY position").all() as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      position: Number(r.position),
      isIncome: Boolean(r.is_income),
    }));
  }

  listCategories(): BudgetCategory[] {
    return (this.db.prepare("SELECT * FROM categories WHERE archived = 0 ORDER BY position").all() as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      groupId: String(r.group_id),
      name: String(r.name),
      position: Number(r.position),
      archived: Boolean(r.archived),
    }));
  }

  categoryNameMap(): Map<string, string> {
    const m = new Map<string, string>();
    for (const c of this.listCategories()) m.set(c.name.toLowerCase(), c.id);
    return m;
  }

  listPayeeRules(): Array<{ id: string; match: string; matchKind: string; categoryId: string; position: number }> {
    return (this.db.prepare("SELECT * FROM payee_rules ORDER BY position").all() as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      match: String(r.match),
      matchKind: String(r.match_kind),
      categoryId: String(r.category_id),
      position: Number(r.position),
    }));
  }

  applyPayeeRule(payee: string): string | null {
    const lower = payee.toLowerCase();
    const rules = this.listPayeeRules();
    for (const rule of rules) {
      if (rule.matchKind === "equals" && lower === rule.match.toLowerCase()) return rule.categoryId;
      if (rule.matchKind === "starts" && lower.startsWith(rule.match.toLowerCase())) return rule.categoryId;
      if (rule.matchKind === "contains" && lower.includes(rule.match.toLowerCase())) return rule.categoryId;
    }
    return null;
  }

  getCsvProfile(accountId: string): CsvMapping | null {
    const r = this.db.prepare("SELECT mapping_json FROM csv_profiles WHERE account_id = ?").get(accountId) as
      | { mapping_json: string }
      | undefined;
    if (!r) return null;
    return JSON.parse(r.mapping_json) as CsvMapping;
  }

  saveCsvProfile(accountId: string, mapping: CsvMapping): void {
    this.db
      .prepare("INSERT INTO csv_profiles (account_id, mapping_json) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET mapping_json = excluded.mapping_json")
      .run(accountId, JSON.stringify(mapping));
  }

  fingerprintExists(accountId: string, fingerprint: string): boolean {
    const r = this.db
      .prepare("SELECT 1 FROM transactions WHERE account_id = ? AND fingerprint = ? LIMIT 1")
      .get(accountId, fingerprint);
    return Boolean(r);
  }

  classifyImportRows(accountId: string, rows: NormalizedImportRow[]): { newCount: number; duplicateCount: number; errorCount: number } {
    let newCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    for (const row of rows) {
      if (row.error) {
        errorCount++;
        continue;
      }
      if (this.fingerprintExists(accountId, row.fingerprint)) duplicateCount++;
      else newCount++;
    }
    return { newCount, duplicateCount, errorCount };
  }

  sumTransactionsForAccount(accountId: string): number {
    const r = this.db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM transactions WHERE account_id = ?").get(accountId) as {
      s: number;
    };
    return Number(r.s);
  }

  accountBalanceCents(account: BudgetAccount): number {
    if (account.archived) return 0;
    if (account.type === "investment") return account.currentBalanceCents ?? 0;
    return account.openingBalanceCents + this.sumTransactionsForAccount(account.id);
  }

  netWorth(): { totalCents: number; accounts: Array<{ id: string; name: string; type: AccountType; balanceCents: number }> } {
    const accounts = this.listAccounts(false).map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balanceCents: this.accountBalanceCents(a),
    }));
    const totalCents = accounts.reduce((sum, a) => sum + a.balanceCents, 0);
    return { totalCents, accounts };
  }

  listBudgetMonth(month: string): Array<{ categoryId: string; budgetedCents: number }> {
    return (
      this.db.prepare("SELECT category_id, budgeted_cents FROM budget_months WHERE month = ?").all(month) as Record<
        string,
        unknown
      >[]
    ).map((r) => ({
      categoryId: String(r.category_id),
      budgetedCents: Number(r.budgeted_cents),
    }));
  }

  setBudgetMonth(month: string, categoryId: string, budgetedCents: number): void {
    if (!categoryId.trim()) throw new ValidationError("category required");
    if (!Number.isInteger(budgetedCents) || budgetedCents < 0) throw new ValidationError("budget must be whole cents");
    const cat = this.db
      .prepare(
        `SELECT c.id, g.is_income AS is_income FROM categories c
         INNER JOIN category_groups g ON g.id = c.group_id
         WHERE c.id = ? AND c.archived = 0`,
      )
      .get(categoryId) as { id: string; is_income: number } | undefined;
    if (!cat) throw new ValidationError("category not found");
    if (cat.is_income) throw new ValidationError("income categories cannot be budgeted");
    this.db
      .prepare(
        `INSERT INTO budget_months (month, category_id, budgeted_cents) VALUES (?, ?, ?)
         ON CONFLICT(month, category_id) DO UPDATE SET budgeted_cents = excluded.budgeted_cents`,
      )
      .run(month, categoryId, budgetedCents);
  }

  getBudgetPrefs(): { overBudgetNotify: boolean } {
    const r = this.db.prepare("SELECT value FROM budget_prefs WHERE key = 'over_budget_notify'").get() as
      | { value: string }
      | undefined;
    return { overBudgetNotify: r?.value === "1" };
  }

  setBudgetPrefs(prefs: { overBudgetNotify?: boolean }): { overBudgetNotify: boolean } {
    if (prefs.overBudgetNotify !== undefined) {
      this.db
        .prepare("INSERT INTO budget_prefs (key, value) VALUES ('over_budget_notify', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(prefs.overBudgetNotify ? "1" : "0");
    }
    return this.getBudgetPrefs();
  }

  deleteAllData(): void {
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM subscription_detections");
      this.db.exec("DELETE FROM subscriptions");
      this.db.exec("DELETE FROM transactions");
      this.db.exec("DELETE FROM import_batches");
      this.db.exec("DELETE FROM budget_months");
      this.db.exec("DELETE FROM payee_rules");
      this.db.exec("DELETE FROM csv_profiles");
      this.db.exec("DELETE FROM accounts");
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  exportSnapshot(): {
    accounts: BudgetAccount[];
    categories: BudgetCategory[];
    groups: BudgetCategoryGroup[];
    transactions: BudgetTransaction[];
    budgetMonths: Array<{ month: string; categoryId: string; budgetedCents: number }>;
    prefs: { overBudgetNotify: boolean };
  } {
    const budgetMonths = (
      this.db.prepare("SELECT month, category_id, budgeted_cents FROM budget_months").all() as Record<string, unknown>[]
    ).map((r) => ({
      month: String(r.month),
      categoryId: String(r.category_id),
      budgetedCents: Number(r.budgeted_cents),
    }));
    return {
      accounts: this.listAccounts(true),
      groups: this.listCategoryGroups(),
      categories: this.listCategories(),
      transactions: this.listAllTransactions(),
      budgetMonths,
      prefs: this.getBudgetPrefs(),
    };
  }

  listTransactions(accountId?: string, limit = 500): BudgetTransaction[] {
    const rows = accountId
      ? (this.db
          .prepare("SELECT * FROM transactions WHERE account_id = ? ORDER BY date DESC, created_at DESC LIMIT ?")
          .all(accountId, limit) as Record<string, unknown>[])
      : (this.db.prepare("SELECT * FROM transactions ORDER BY date DESC, created_at DESC LIMIT ?").all(limit) as Record<
          string,
          unknown
        >[]);
    return rows.map(rowTx);
  }

  listTransactionsInMonth(month: string, accountId?: string): BudgetTransaction[] {
    const { start, end } = monthDateBounds(month);
    const rows = accountId
      ? (this.db
          .prepare(
            "SELECT * FROM transactions WHERE account_id = ? AND date >= ? AND date <= ? ORDER BY date DESC, created_at DESC",
          )
          .all(accountId, start, end) as Record<string, unknown>[])
      : (this.db
          .prepare("SELECT * FROM transactions WHERE date >= ? AND date <= ? ORDER BY date DESC, created_at DESC")
          .all(start, end) as Record<string, unknown>[]);
    return rows.map(rowTx);
  }

  listAllTransactions(): BudgetTransaction[] {
    const rows = this.db
      .prepare("SELECT * FROM transactions ORDER BY date DESC, created_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map(rowTx);
  }

  createTransaction(input: {
    accountId: string;
    date: string;
    amountCents: number;
    payee?: string;
    memo?: string;
    categoryId?: string | null;
    transferAccountId?: string | null;
  }): BudgetTransaction {
    if (!Number.isInteger(input.amountCents)) throw new ValidationError("amount must be whole cents");
    const account = this.getAccount(input.accountId);
    if (!account) throw new ValidationError("account not found");
    if (account.type === "investment") throw new ValidationError("investment accounts use manual balance only");
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO transactions (id, account_id, date, amount_cents, payee, memo, category_id, transfer_account_id, cleared, fingerprint, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
      )
      .run(
        id,
        input.accountId,
        input.date,
        input.amountCents,
        (input.payee ?? "").slice(0, 240),
        (input.memo ?? "").slice(0, 500),
        input.categoryId ?? null,
        input.transferAccountId ?? null,
        now,
        now,
      );
    return rowTx(this.db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as Record<string, unknown>);
  }

  commitImport(opts: {
    accountId: string;
    fileName: string | null;
    fileSha256: string;
    mapping: CsvMapping;
    invertSign: boolean;
    rows: NormalizedImportRow[];
  }): ImportBatch {
    if (opts.rows.length > BUDGET_IMPORT_MAX_ROWS) throw new ValidationError("too many rows");
    const account = this.getAccount(opts.accountId);
    if (!account) throw new ValidationError("account not found");
    if (account.type === "investment") throw new ValidationError("cannot import into investment accounts");
    const batchId = randomUUID();
    const now = new Date().toISOString();
    let added = 0;
    let skipped = 0;
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO import_batches (id, account_id, file_name, file_sha256, rows_total, rows_added, rows_skipped, mapping_json, created_at)
           VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        )
        .run(
          batchId,
          opts.accountId,
          opts.fileName,
          opts.fileSha256,
          opts.rows.length,
          JSON.stringify({ mapping: opts.mapping, invertSign: opts.invertSign }),
          now,
        );
      for (const row of opts.rows) {
        if (row.error) {
          skipped++;
          continue;
        }
        if (this.fingerprintExists(opts.accountId, row.fingerprint)) {
          skipped++;
          continue;
        }
        const id = randomUUID();
        try {
          this.db
            .prepare(
              `INSERT INTO transactions (id, account_id, date, amount_cents, payee, memo, category_id, import_batch_id, fingerprint, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              opts.accountId,
              row.date,
              row.amountCents,
              row.payee.slice(0, 240),
              row.memo.slice(0, 500),
              row.categoryId,
              batchId,
              row.fingerprint,
              now,
              now,
            );
          added++;
        } catch {
          skipped++;
        }
      }
      this.db
        .prepare("UPDATE import_batches SET rows_added = ?, rows_skipped = ? WHERE id = ?")
        .run(added, skipped, batchId);
      if (opts.invertSign !== account.invertSign) {
        this.db.prepare("UPDATE accounts SET invert_sign = ?, updated_at = ? WHERE id = ?").run(opts.invertSign ? 1 : 0, now, opts.accountId);
      }
      this.saveCsvProfile(opts.accountId, opts.mapping);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return this.getImportBatch(batchId)!;
  }

  getImportBatch(id: string): ImportBatch | undefined {
    const r = this.db.prepare("SELECT * FROM import_batches WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      id: String(r.id),
      accountId: String(r.account_id),
      fileName: r.file_name == null ? null : String(r.file_name),
      fileSha256: String(r.file_sha256),
      rowsTotal: Number(r.rows_total),
      rowsAdded: Number(r.rows_added),
      rowsSkipped: Number(r.rows_skipped),
      mappingJson: String(r.mapping_json),
      createdAt: String(r.created_at),
      undoneAt: r.undone_at == null ? null : String(r.undone_at),
    };
  }

  listImportBatches(limit = 50): ImportBatch[] {
    return (this.db.prepare("SELECT * FROM import_batches ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[]).map(
      (r) => ({
        id: String(r.id),
        accountId: String(r.account_id),
        fileName: r.file_name == null ? null : String(r.file_name),
        fileSha256: String(r.file_sha256),
        rowsTotal: Number(r.rows_total),
        rowsAdded: Number(r.rows_added),
        rowsSkipped: Number(r.rows_skipped),
        mappingJson: String(r.mapping_json),
        createdAt: String(r.created_at),
        undoneAt: r.undone_at == null ? null : String(r.undone_at),
      }),
    );
  }

  undoImport(batchId: string): ImportBatch | undefined {
    const batch = this.getImportBatch(batchId);
    if (!batch || batch.undoneAt) return undefined;
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM import_batches WHERE id = ?").run(batchId);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return { ...batch, undoneAt: now };
  }

  static sha256(buffer: Buffer): string {
    return createHash("sha256").update(buffer).digest("hex");
  }

  listOutflowChargesSince(isoDate: string): Array<{ date: string; amountCents: number; payee: string }> {
    return (
      this.db
        .prepare(
          `SELECT date, amount_cents, payee FROM transactions
           WHERE amount_cents < 0 AND (transfer_account_id IS NULL OR transfer_account_id = '')
           AND date >= ?
           ORDER BY date ASC`,
        )
        .all(isoDate) as Record<string, unknown>[]
    ).map((r) => ({
      date: String(r.date),
      amountCents: Number(r.amount_cents),
      payee: String(r.payee ?? ""),
    }));
  }

  private rowSubscription(r: Record<string, unknown>): SubscriptionRow {
    return {
      id: String(r.id),
      payeeNormalized: String(r.payee_normalized),
      displayName: String(r.display_name),
      amountCents: Number(r.amount_cents),
      currency: String(r.currency ?? "USD"),
      cadence: String(r.cadence) as SubscriptionCadence,
      anchorDate: String(r.anchor_date),
      categoryId: r.category_id == null ? null : String(r.category_id),
      active: Boolean(r.active),
      source: String(r.source) as SubscriptionSource,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  private rowDetection(r: Record<string, unknown>): SubscriptionDetectionRow {
    return {
      id: String(r.id),
      payeeNormalized: String(r.payee_normalized),
      displayName: String(r.display_name),
      amountCents: Number(r.amount_cents),
      cadence: String(r.cadence) as SubscriptionCadence,
      detectionKind: String(r.detection_kind) as SubscriptionDetectionRow["detectionKind"],
      confidence: Number(r.confidence),
      sampleDates: JSON.parse(String(r.sample_dates_json)) as string[],
      status: String(r.status) as SubscriptionDetectionRow["status"],
      dismissedAt: r.dismissed_at == null ? null : String(r.dismissed_at),
      createdAt: String(r.created_at),
      laneKey: String(r.lane_key),
    };
  }

  listSubscriptions(includeInactive = false): SubscriptionRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM subscriptions ${includeInactive ? "" : "WHERE active = 1"} ORDER BY display_name COLLATE NOCASE`,
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowSubscription(r));
  }

  listPendingDetections(): SubscriptionDetectionRow[] {
    return (
      this.db
        .prepare("SELECT * FROM subscription_detections WHERE status = 'pending' ORDER BY confidence DESC, created_at DESC")
        .all() as Record<string, unknown>[]
    ).map((r) => this.rowDetection(r));
  }

  getSubscription(id: string): SubscriptionRow | undefined {
    const r = this.db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return r ? this.rowSubscription(r) : undefined;
  }

  getDetection(id: string): SubscriptionDetectionRow | undefined {
    const r = this.db.prepare("SELECT * FROM subscription_detections WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? this.rowDetection(r) : undefined;
  }

  /** Active or deactivated subscriptions suppress detections in the same amount band. */
  hasSubscriptionSuppressingDetection(
    payeeNormalized: string,
    cadence: SubscriptionCadence,
    amountCents: number,
  ): boolean {
    const rows = this.db
      .prepare("SELECT amount_cents FROM subscriptions WHERE payee_normalized = ? AND cadence = ?")
      .all(payeeNormalized, cadence) as Record<string, unknown>[];
    for (const r of rows) {
      if (this.detectionAmountMatches(Number(r.amount_cents), amountCents)) return true;
    }
    return false;
  }

  syncActiveSubscriptionAmountsFromCharges(
    charges: Array<{ payeeNormalized: string; amountCents: number; date: string }>,
  ): void {
    for (const sub of this.listSubscriptions(false)) {
      const related = charges.filter(
        (c) =>
          c.payeeNormalized === sub.payeeNormalized &&
          this.detectionAmountMatches(sub.amountCents, c.amountCents),
      );
      if (!related.length) continue;
      related.sort((a, b) => b.date.localeCompare(a.date));
      const latest = related[0]!.amountCents;
      if (latest !== sub.amountCents) {
        this.updateSubscription(sub.id, { amountCents: latest });
      }
    }
  }

  private detectionAmountMatches(storedAmountCents: number, candidateAmountCents: number): boolean {
    return amountInCluster(Math.abs(storedAmountCents), candidateAmountCents);
  }

  isDetectionPermanentlyDismissed(
    payeeNormalized: string,
    cadence: SubscriptionCadence,
    amountCents: number,
  ): boolean {
    const rows = this.db
      .prepare(
        `SELECT amount_cents FROM subscription_detections
         WHERE payee_normalized = ? AND cadence = ? AND dismissed_at IS NOT NULL`,
      )
      .all(payeeNormalized, cadence) as Record<string, unknown>[];
    for (const r of rows) {
      if (this.detectionAmountMatches(Number(r.amount_cents), amountCents)) return true;
    }
    return false;
  }

  hasPendingDetectionMatch(
    payeeNormalized: string,
    cadence: SubscriptionCadence,
    amountCents: number,
  ): boolean {
    const rows = this.db
      .prepare(
        `SELECT amount_cents FROM subscription_detections
         WHERE payee_normalized = ? AND cadence = ? AND status = 'pending'`,
      )
      .all(payeeNormalized, cadence) as Record<string, unknown>[];
    for (const r of rows) {
      if (this.detectionAmountMatches(Number(r.amount_cents), amountCents)) return true;
    }
    return false;
  }

  insertDetection(input: {
    id: string;
    payeeNormalized: string;
    displayName: string;
    amountCents: number;
    cadence: SubscriptionCadence;
    detectionKind: SubscriptionDetectionRow["detectionKind"];
    confidence: number;
    sampleDates: string[];
    laneKey: string;
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO subscription_detections (id, payee_normalized, display_name, amount_cents, cadence, detection_kind, confidence, sample_dates_json, lane_key, status, dismissed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`,
      )
      .run(
        input.id,
        input.payeeNormalized,
        input.displayName.slice(0, 240),
        input.amountCents,
        input.cadence,
        input.detectionKind,
        input.confidence,
        JSON.stringify(input.sampleDates),
        input.laneKey,
        now,
      );
  }

  createSubscriptionManual(input: {
    displayName: string;
    payee?: string;
    amountCents: number;
    cadence: SubscriptionCadence;
    anchorDate: string;
    categoryId: string;
    currency?: string;
  }): SubscriptionRow {
    if (!Number.isInteger(input.amountCents) || input.amountCents >= 0) {
      throw new ValidationError("subscription amount must be negative whole cents");
    }
    const name = input.displayName.trim().slice(0, 240);
    if (!name) throw new ValidationError("display name required");
    const payeeRaw = (input.payee ?? name).trim().slice(0, 240);
    const payeeNormalized = normalizePayee(payeeRaw);
    try {
      requireValidIsoDate(input.anchorDate);
    } catch {
      throw new ValidationError("invalid anchor date");
    }
    const cat = this.db.prepare("SELECT id FROM categories WHERE id = ? AND archived = 0").get(input.categoryId);
    if (!cat) throw new ValidationError("category not found");
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO subscriptions (id, payee_normalized, display_name, amount_cents, currency, cadence, anchor_date, category_id, active, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'manual', ?, ?)`,
      )
      .run(
        id,
        payeeNormalized,
        name,
        input.amountCents,
        input.currency ?? "USD",
        input.cadence,
        input.anchorDate,
        input.categoryId,
        now,
        now,
      );
    return this.getSubscription(id)!;
  }

  updateSubscription(
    id: string,
    patch: Partial<{
      displayName: string;
      payee: string;
      amountCents: number;
      cadence: SubscriptionCadence;
      anchorDate: string;
      categoryId: string | null;
      active: boolean;
    }>,
  ): SubscriptionRow | undefined {
    const cur = this.getSubscription(id);
    if (!cur) return undefined;
    if (patch.amountCents != null && (!Number.isInteger(patch.amountCents) || patch.amountCents >= 0)) {
      throw new ValidationError("subscription amount must be negative whole cents");
    }
    const now = new Date().toISOString();
    const displayName = patch.displayName != null ? patch.displayName.trim().slice(0, 240) : cur.displayName;
    if (patch.anchorDate != null) {
      try {
        requireValidIsoDate(patch.anchorDate);
      } catch {
        throw new ValidationError("invalid anchor date");
      }
    }
    const payeeNormalized =
      patch.payee != null ? normalizePayee(patch.payee.trim().slice(0, 240)) : cur.payeeNormalized;
    this.db
      .prepare(
        `UPDATE subscriptions SET payee_normalized = ?, display_name = ?, amount_cents = ?, cadence = ?, anchor_date = ?, category_id = ?, active = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        payeeNormalized,
        displayName,
        patch.amountCents ?? cur.amountCents,
        patch.cadence ?? cur.cadence,
        patch.anchorDate ?? cur.anchorDate,
        patch.categoryId !== undefined ? patch.categoryId : cur.categoryId,
        patch.active !== undefined ? (patch.active ? 1 : 0) : cur.active ? 1 : 0,
        now,
        id,
      );
    return this.getSubscription(id);
  }

  confirmDetection(
    detectionId: string,
    input: { categoryId: string; cadence?: SubscriptionCadence; displayName?: string },
  ): SubscriptionRow | undefined {
    const det = this.getDetection(detectionId);
    if (!det || det.status !== "pending") return undefined;
    if (!input.categoryId.trim()) throw new ValidationError("category required");
    const cat = this.db.prepare("SELECT id FROM categories WHERE id = ? AND archived = 0").get(input.categoryId);
    if (!cat) throw new ValidationError("category not found");
    const cadence = input.cadence ?? det.cadence;
    const displayName = (input.displayName ?? det.displayName).trim().slice(0, 240);
    const anchorDate = det.sampleDates[det.sampleDates.length - 1] ?? new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO subscriptions (id, payee_normalized, display_name, amount_cents, currency, cadence, anchor_date, category_id, active, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, 1, 'detected', ?, ?)`,
        )
        .run(id, det.payeeNormalized, displayName, det.amountCents, cadence, anchorDate, input.categoryId, now, now);
      this.db
        .prepare("UPDATE subscription_detections SET status = 'confirmed' WHERE id = ?")
        .run(detectionId);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return this.getSubscription(id);
  }

  dismissDetection(detectionId: string): SubscriptionDetectionRow | undefined {
    const det = this.getDetection(detectionId);
    if (!det || det.status !== "pending") return undefined;
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE subscription_detections SET status = 'dismissed', dismissed_at = ? WHERE id = ?")
      .run(now, detectionId);
    return this.getDetection(detectionId);
  }

  subscriptionsForApi(cfg: { tz: string }, now = new Date()): {
    subscriptions: Array<
      SubscriptionRow & { annualCostCents: number; nextDueDate: string }
    >;
    detections: SubscriptionDetectionRow[];
  } {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: cfg.tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const subs = this.listSubscriptions(false).map((s) => ({
      ...s,
      annualCostCents: annualCostCents(s.amountCents, s.cadence),
      nextDueDate: safeNextDueDate(s.cadence, s.anchorDate, cfg.tz, today) ?? "—",
    }));
    return { subscriptions: subs, detections: this.listPendingDetections() };
  }
}
