/** Day-plan API owner gate: CF-verified owner only (`who.owner === true`). */
export function isDayPlanOwner(principal: { owner: boolean }): boolean {
  return principal.owner === true;
}
