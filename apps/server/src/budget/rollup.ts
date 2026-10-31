import type { Config } from "../config";
import { dayKey } from "../store";
import type { BudgetCategory, BudgetCategoryGroup, BudgetTransaction } from "./store";
import type { BudgetStore } from "./store";

/** Max transactions scanned per rollup (explicit cap; panel uses the same rollup). */
export const BUDGET_ROLLUP_TX_LIMIT = 100_000;

export const BUDGET_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseBudgetMonth(input: string): string | null {
  return BUDGET_MONTH_PATTERN.test(input) ? input : null;
}

export interface CategoryRollupRow {
  categoryId: string;
  categoryName: string;
  groupId: string;
  groupName: string;
  isIncome: boolean;
  spentCents: number;
  budgetedCents: number;
}

export interface BudgetRollup {
  month: string;
  incomeCents: number;
  spendCents: number;
  cashFlowCents: number;
  byCategory: CategoryRollupRow[];
  /** Expense categories with non-zero net spend/refund, largest spend first. */
  topCategories: CategoryRollupRow[];
}

/**
 * Rollup rules (totals match sum of expense-category rows):
 * - Transfers (`transfer_account_id`) are excluded.
 * - Income-category transactions add to `incomeCents` only.
 * - Uncategorized **positive** amounts are inflows → `incomeCents` only.
 * - All other non-transfer rows (expense categories and uncategorized outflows/refunds) add to
 *   `spendCents` and per-category `spentCents` (refunds are positive and reduce net spend).
 */
export function monthKey(d: Date, tz: string): string {
  return dayKey(d, tz).slice(0, 7);
}

function inMonth(date: string, month: string): boolean {
  return date.length >= 7 && date.slice(0, 7) === month;
}

function isTransfer(tx: BudgetTransaction): boolean {
  return tx.transferAccountId != null && tx.transferAccountId !== "";
}

export function topSpendingCategoryRows(rows: CategoryRollupRow[], limit = 8): CategoryRollupRow[] {
  return rows
    .filter((r) => r.spentCents !== 0)
    .sort((a, b) => a.spentCents - b.spentCents)
    .slice(0, limit);
}

export function sumCategorySpentCents(rows: CategoryRollupRow[]): number {
  return rows.reduce((sum, r) => sum + r.spentCents, 0);
}

export function computeRollup(
  store: BudgetStore,
  cfg: Config,
  month: string,
  now = new Date(),
): BudgetRollup {
  const resolvedMonth = month || monthKey(now, cfg.tz);
  const groups = store.listCategoryGroups();
  const categories = store.listCategories();
  const groupById = new Map<string, BudgetCategoryGroup>(groups.map((g) => [g.id, g]));
  const catById = new Map<string, BudgetCategory>(categories.map((c) => [c.id, c]));
  const budgeted = store.listBudgetMonth(resolvedMonth);
  const budgetedByCat = new Map(budgeted.map((b) => [b.categoryId, b.budgetedCents]));

  const spentByCat = new Map<string, number>();
  let incomeCents = 0;
  let spendCents = 0;

  for (const tx of store.listTransactions(undefined, BUDGET_ROLLUP_TX_LIMIT)) {
    if (!inMonth(tx.date, resolvedMonth) || isTransfer(tx)) continue;
    const amount = tx.amountCents;
    const cat = tx.categoryId ? catById.get(tx.categoryId) : undefined;
    const group = cat ? groupById.get(cat.groupId) : undefined;
    const isIncome = group?.isIncome === true;

    if (isIncome) {
      incomeCents += amount;
      continue;
    }

    if (!tx.categoryId && amount > 0) {
      incomeCents += amount;
      continue;
    }

    spendCents += amount;
    const cid = tx.categoryId ?? "__uncategorized";
    spentByCat.set(cid, (spentByCat.get(cid) ?? 0) + amount);
  }

  const byCategory: CategoryRollupRow[] = [];
  for (const cat of categories) {
    const group = groupById.get(cat.groupId);
    if (group?.isIncome) continue;
    const spent = spentByCat.get(cat.id) ?? 0;
    byCategory.push({
      categoryId: cat.id,
      categoryName: cat.name,
      groupId: cat.groupId,
      groupName: group?.name ?? "",
      isIncome: false,
      spentCents: spent,
      budgetedCents: budgetedByCat.get(cat.id) ?? 0,
    });
  }
  if (spentByCat.has("__uncategorized")) {
    byCategory.push({
      categoryId: "",
      categoryName: "Uncategorized",
      groupId: "",
      groupName: "",
      isIncome: false,
      spentCents: spentByCat.get("__uncategorized")!,
      budgetedCents: 0,
    });
  }
  byCategory.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.categoryName.localeCompare(b.categoryName));

  const topCategories = topSpendingCategoryRows(byCategory);

  return {
    month: resolvedMonth,
    incomeCents,
    spendCents,
    cashFlowCents: incomeCents + spendCents,
    byCategory,
    topCategories,
  };
}
