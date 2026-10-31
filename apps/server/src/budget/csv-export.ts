import type { BudgetAccount, BudgetTransaction } from "./store";

/** Prefix cells that could execute as spreadsheet formulas. */
export function neutralizeSpreadsheetCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

function csvQuoted(value: string): string {
  const neutral = neutralizeSpreadsheetCell(value);
  return `"${neutral.replace(/"/g, '""')}"`;
}

export function budgetExportCsvLines(accounts: BudgetAccount[], transactions: BudgetTransaction[]): string[] {
  const lines = ["type,id,account_id,account_name,date,amount_cents,payee,memo,category_id"];
  for (const a of accounts) {
    lines.push(["account", a.id, "", csvQuoted(a.name), "", "", "", "", ""].join(","));
  }
  for (const tx of transactions) {
    lines.push(
      [
        "transaction",
        tx.id,
        tx.accountId,
        "",
        tx.date,
        String(tx.amountCents),
        csvQuoted(tx.payee),
        csvQuoted(tx.memo),
        tx.categoryId ?? "",
      ].join(","),
    );
  }
  return lines;
}
