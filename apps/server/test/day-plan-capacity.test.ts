import { test } from "node:test";
import assert from "node:assert/strict";
import {
  availableMinutesForDay,
  capacityFromOccurrences,
  clipIntervalToWindow,
  isWeekendDay,
  mergeIntervalMinutes,
  workWindowBoundsMs,
} from "../src/day-plan/capacity";
import { durationMsOnDay } from "../src/calendar/day-duration";

test("day-plan capacity: weekend defaults to 0 available", () => {
  const sat = "2026-11-07";
  assert.equal(isWeekendDay(sat, "America/Chicago"), true);
  assert.equal(availableMinutesForDay(sat, "America/Chicago", "09:00", "17:00", false), 0);
  assert.equal(availableMinutesForDay(sat, "America/Chicago", "09:00", "17:00", true), 480);
});

test("day-plan capacity: clips and merges overlapping meetings", () => {
  const day = "2026-06-02";
  const tz = "America/Chicago";
  const win = workWindowBoundsMs(day, tz, "09:00", "17:00");
  assert.ok(win);
  const a = clipIntervalToWindow(win!.startMs + 60_000, win!.startMs + 120 * 60_000, win!)!;
  const b = clipIntervalToWindow(win!.startMs + 90 * 60_000, win!.startMs + 150 * 60_000, win!)!;
  const merged = mergeIntervalMinutes([a, b]);
  assert.ok(merged >= 149 && merged <= 150);
  const cap = capacityFromOccurrences({
    day,
    tz,
    workStart: "09:00",
    workEnd: "17:00",
    weekendOverride: false,
    occurrences: [
      { startMs: win!.startMs + 60_000, endMs: win!.startMs + 120 * 60_000, isBlock: false },
      { startMs: win!.startMs + 90 * 60_000, endMs: win!.startMs + 150 * 60_000, isBlock: false },
    ],
    unscheduledEstimateMinutes: 0,
  });
  assert.equal(cap.meetingMinutes, merged);
  assert.equal(cap.availableMinutes, 480);
});

test("day-plan capacity: all-day duration does not add to timed capacity totals", () => {
  const day = "2026-06-03";
  const tz = "Asia/Tokyo";
  const allDayMs = durationMsOnDay(
    { start: "2026-06-03", end: "2026-06-04", allDay: true, timezone: tz },
    day,
    tz,
  );
  assert.ok(allDayMs > 0);
  const cap = capacityFromOccurrences({
    day,
    tz,
    workStart: "09:00",
    workEnd: "17:00",
    weekendOverride: false,
    occurrences: [],
    unscheduledEstimateMinutes: 60,
  });
  assert.equal(cap.meetingMinutes, 0);
  assert.equal(cap.blockedTaskMinutes, 0);
  assert.equal(cap.unscheduledTaskMinutes, 60);
  assert.equal(cap.overByMinutes, 0);
});

test("day-plan capacity: DST spring-forward weekday has full 8h window", () => {
  const day = "2026-03-09";
  const tz = "America/Chicago";
  assert.equal(availableMinutesForDay(day, tz, "09:00", "17:00", false), 480);
});
