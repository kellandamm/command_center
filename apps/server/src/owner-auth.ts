import type { Config } from "./config";

/** Shown when a dashboard write requires Cloudflare Access owner identity. */
export const OWNER_ACTION_FORBIDDEN =
  "This action requires a verified owner login. Set OWNER_EMAILS and sign in through Cloudflare Access.";

export type SharedSettingsPrincipal = { owner?: boolean; who: string };

/** Shared server preferences (settings, layout, capture tokens). */
export function canManageSharedServerState(cfg: Config, principal: SharedSettingsPrincipal): boolean {
  if (!cfg.ownerEmails.length) return true;
  if (principal.owner) return true;
  // shortcut: ADMIN_TOKEN keeps automation/tests working when OWNER_EMAILS splits human owners from machine auth.
  if (principal.who === "admin-token" && cfg.adminToken) return true;
  return false;
}
