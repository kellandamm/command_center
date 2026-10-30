const SAFE_DETAIL_KEYS = new Set(["code", "route", "row", "status"]);

/** Log budget failures without payees, amounts, account names, or file contents. */
export function logBudgetError(code: string, detail?: Record<string, string | number>): void {
  if (!detail) {
    console.error(`budget: ${code}`);
    return;
  }
  const safe: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (SAFE_DETAIL_KEYS.has(k)) safe[k] = v;
  }
  console.error(`budget: ${code}`, Object.keys(safe).length ? safe : undefined);
}
