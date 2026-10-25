import type { Config } from "./config";

/** Shown when a dashboard write requires Cloudflare Access owner identity. */
export const OWNER_ACTION_FORBIDDEN =
  "This action requires a verified owner login. Set OWNER_EMAILS and sign in through Cloudflare Access.";

export type SharedSettingsPrincipal = { owner?: boolean; who: string; email?: string; serviceToken?: boolean };

export type OwnerReason =
  | "owner"
  | "admin-token"
  | "no-owner-emails"
  | "email-not-in-owner-emails"
  | "no-email-claim"
  | "service-token";

/** Shared server preferences (settings, layout, capture tokens). */
export function canManageSharedServerState(cfg: Config, principal: SharedSettingsPrincipal): boolean {
  if (!cfg.ownerEmails.length) return true;
  if (principal.owner) return true;
  // shortcut: ADMIN_TOKEN keeps automation/tests working when OWNER_EMAILS splits human owners from machine auth.
  if (principal.who === "admin-token" && cfg.adminToken) return true;
  return false;
}

export function computeOwnerReason(cfg: Config, principal: SharedSettingsPrincipal): OwnerReason {
  if (!cfg.ownerEmails.length) return "no-owner-emails";
  if (principal.owner) return "owner";
  if (principal.who === "admin-token" && cfg.adminToken) return "admin-token";
  if (principal.serviceToken) return "service-token";
  if (!principal.email) return "no-email-claim";
  return "email-not-in-owner-emails";
}
