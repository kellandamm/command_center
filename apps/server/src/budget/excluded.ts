/**
 * Budget data must never appear in LLM prompts, MCP tools, webhooks, briefings, or push text.
 * Do not add BudgetStore to IntegrationDeps or import budget modules from agent-facing code paths.
 */
export const BUDGET_AGENT_EXCLUSION = "budget-never-in-agent-context" as const;
