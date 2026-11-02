/** Budget, subscriptions, and vault data must never appear in day-plan gather, planner, or LLM paths. */
export const DAY_PLAN_AGENT_EXCLUSION = "day-plan-never-budget-subscriptions-vault" as const;
