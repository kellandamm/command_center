import { dayKey } from "../src/store";
import { dayParamFromQuery } from "../src/day-plan/validate";

export const PLAN_TEST_TZ = "America/Chicago";

function shiftCal(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

function civilDow(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/** First calendar day on/after today in tz with the given JS weekday (0=Sun … 6=Sat), within plan range. */
export function nextWeekdayOnOrAfter(tz: string, now: Date, dow: number): string {
  const today = dayKey(now, tz);
  for (let i = 0; i < 120; i++) {
    const d = shiftCal(today, i);
    if (civilDow(d) !== dow) continue;
    try {
      dayParamFromQuery(d, tz, now);
      return d;
    } catch {
      continue;
    }
  }
  throw new Error(`no weekday ${dow} within plan range in the next 120 days`);
}

export function planTestSaturday(now = new Date()): string {
  return nextWeekdayOnOrAfter(PLAN_TEST_TZ, now, 6);
}

export function planTestMonday(now = new Date()): string {
  return nextWeekdayOnOrAfter(PLAN_TEST_TZ, now, 1);
}
