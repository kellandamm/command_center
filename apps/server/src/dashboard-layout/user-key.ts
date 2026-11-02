/** Stable filesystem key for per-user dashboard layout files. */
export function dashboardLayoutUserKey(principal: { who: string; email?: string }): string {
  const raw = (principal.email ?? principal.who).trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9._@-]+/g, "_").slice(0, 120);
  return safe || "anonymous";
}
