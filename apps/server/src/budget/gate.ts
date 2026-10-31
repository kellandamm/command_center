import type { Config } from "../config";

/** Budget is active only when Cloudflare Access and owner emails are fully configured. */
export function budgetAvailable(cfg: Config): boolean {
  return Boolean(cfg.cfTeamDomain && cfg.cfAud?.length && cfg.ownerEmails.length);
}

export const BUDGET_DISABLED_MESSAGE =
  "Budget is not enabled. Set CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD, and OWNER_EMAILS.";

export function budgetPanelVisible(cfg: Config, owner: boolean): boolean {
  return budgetAvailable(cfg) && owner;
}
