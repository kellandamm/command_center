/** Sensitive finance/vault modules must never appear in day-plan gather, planner, or LLM paths. */
const B = "budget";
export const DAY_PLAN_FORBIDDEN_IMPORT_SUBSTRINGS = [
  `${B}/`,
  "BudgetStore",
  "sub" + "scriptions",
  "home-vault",
] as const;
