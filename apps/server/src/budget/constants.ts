export const BUDGET_DATABASE_FILE = "budget.sqlite";
export const BUDGET_IMPORT_MAX_BYTES = 5_000_000;
export const BUDGET_IMPORT_MAX_ROWS = 20_000;
export const BUDGET_PREVIEW_TTL_MS = 15 * 60 * 1000;
export const BUDGET_PREVIEW_SAMPLE_ROWS = 50;

export const ACCOUNT_TYPES = ["checking", "savings", "credit", "cash", "investment"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const DATE_FORMATS = ["MM/DD/YYYY", "YYYY-MM-DD", "DD/MM/YYYY"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
