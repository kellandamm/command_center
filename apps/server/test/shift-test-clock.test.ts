import { test } from "node:test";
import assert from "node:assert/strict";
import { dayKey } from "../src/store";
import { dayParamFromQuery } from "../src/day-plan/validate";
import { withClockShiftedByDays } from "./shift-test-clock";
import { PLAN_TEST_TZ } from "./day-plan-relative-days";

test("shift-test-clock: +30d keeps day-plan range checks date-independent", async () => {
  await withClockShiftedByDays(30, () => {
    const now = new Date();
    const today = dayKey(now, PLAN_TEST_TZ);
    assert.doesNotThrow(() => dayParamFromQuery(today, PLAN_TEST_TZ, now));
  });
});

test("shift-test-clock: DST spring-forward gap uses invalid work time, not end-before-start", async () => {
  const { assertValidWorkWindow } = await import("../src/day-plan/validate");
  await withClockShiftedByDays(30, () => {
    assert.throws(
      () => assertValidWorkWindow("02:30", "03:30", "2026-03-08", "America/Chicago"),
      (err: Error) => err.message === "Invalid work time.",
    );
  });
});
