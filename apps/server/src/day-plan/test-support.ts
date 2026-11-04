import { inflight, testHooks } from "./must-do-limits";

if (process.argv.some((a) => /day-plan-must-do\.test/.test(a))) {
  process.env.ALLOW_DAY_PLAN_TEST_HOOKS = "1";
}

/** No-op in production unless ALLOW_DAY_PLAN_TEST_HOOKS=1 (day-plan must-do tests set this). */
export function setBoardMoveDelayMsForTests(ms: number | null): void {
  if (process.env.ALLOW_DAY_PLAN_TEST_HOOKS !== "1") return;
  testHooks.boardMoveDelayMs = ms;
}

export function clearMustDoInflightForTests(): void {
  if (process.env.ALLOW_DAY_PLAN_TEST_HOOKS !== "1") return;
  inflight.clear();
  testHooks.boardMoveDelayMs = null;
}
