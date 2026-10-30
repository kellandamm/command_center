import type { AuthResult } from "../auth";

export function isBudgetOwner(who: AuthResult & { ok: true }): boolean {
  return who.owner === true && Boolean(who.email);
}
