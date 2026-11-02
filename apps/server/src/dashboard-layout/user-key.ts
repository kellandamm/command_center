import { createHash } from "node:crypto";

/** Stable collision-resistant filesystem key for per-user dashboard layout files. */
export function dashboardLayoutUserKey(principal: { who: string; email?: string }): string {
  const raw = (principal.email ?? principal.who).trim().toLowerCase();
  if (!raw) return "anonymous";
  const digest = createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 32);
  return `u_${digest}`;
}
