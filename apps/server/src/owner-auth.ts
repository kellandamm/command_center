import type { Config } from "./config";

/** Shown when a dashboard write requires Cloudflare Access owner identity. */
export const OWNER_ACTION_FORBIDDEN =
  "This action requires a verified owner login. Set OWNER_EMAILS and sign in through Cloudflare Access.";

/** Shared server preferences (settings, layout, capture tokens) when OWNER_EMAILS is configured. */
export function canManageSharedServerState(cfg: Config, owner: boolean): boolean {
  if (!cfg.ownerEmails.length) return true;
  return owner;
}
