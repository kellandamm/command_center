import { calendarLocalInstant } from "../calendar/store";
import { dayRangeIso } from "../calendar/day-duration";
import type { DayPlanCapacity } from "./types";

export function isWeekendDay(day: string, tz: string): boolean {
  const noon = calendarLocalInstant(day, "12:00", tz);
  if (!noon) return false;
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(noon);
  return wd === "Sat" || wd === "Sun";
}

export function workWindowBoundsMs(day: string, tz: string, workStart: string, workEnd: string): { startMs: number; endMs: number } | null {
  const start = calendarLocalInstant(day, workStart, tz);
  const end = calendarLocalInstant(day, workEnd, tz);
  if (!start || !end || end.getTime() <= start.getTime()) return null;
  return { startMs: start.getTime(), endMs: end.getTime() };
}

export function availableMinutesForDay(
  day: string,
  tz: string,
  workStart: string,
  workEnd: string,
  weekendOverride: boolean,
): number {
  if (!weekendOverride && isWeekendDay(day, tz)) return 0;
  const win = workWindowBoundsMs(day, tz, workStart, workEnd);
  if (!win) return 0;
  return Math.round((win.endMs - win.startMs) / 60_000);
}

/** Clip [startMs,endMs] to work window; return null if no overlap. */
export function clipIntervalToWindow(
  startMs: number,
  endMs: number,
  win: { startMs: number; endMs: number },
): [number, number] | null {
  const a = Math.max(startMs, win.startMs);
  const b = Math.min(endMs, win.endMs);
  if (b <= a) return null;
  return [a, b];
}

export function mergeIntervalMinutes(intervals: Array<[number, number]>): number {
  if (!intervals.length) return 0;
  const sorted = intervals.slice().sort((x, y) => x[0] - y[0]);
  let total = 0;
  let [curA, curB] = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const [a, b] = sorted[i]!;
    if (a <= curB) curB = Math.max(curB, b);
    else {
      total += curB - curA;
      [curA, curB] = [a, b];
    }
  }
  total += curB - curA;
  return Math.round(total / 60_000);
}

export interface TimedOccurrence {
  startMs: number;
  endMs: number;
  isBlock: boolean;
}

export function capacityFromOccurrences(opts: {
  day: string;
  tz: string;
  workStart: string;
  workEnd: string;
  weekendOverride: boolean;
  occurrences: TimedOccurrence[];
  unscheduledEstimateMinutes: number;
}): DayPlanCapacity {
  const availableMinutes = availableMinutesForDay(opts.day, opts.tz, opts.workStart, opts.workEnd, opts.weekendOverride);
  const win = workWindowBoundsMs(opts.day, opts.tz, opts.workStart, opts.workEnd);
  if (!win) {
    const unscheduled = opts.unscheduledEstimateMinutes;
    return {
      availableMinutes: 0,
      meetingMinutes: 0,
      blockedTaskMinutes: 0,
      unscheduledTaskMinutes: unscheduled,
      overByMinutes: Math.max(0, unscheduled),
    };
  }
  const meetingClips: Array<[number, number]> = [];
  const blockClips: Array<[number, number]> = [];
  const allClips: Array<[number, number]> = [];
  for (const occ of opts.occurrences) {
    const clip = clipIntervalToWindow(occ.startMs, occ.endMs, win);
    if (!clip) continue;
    allClips.push(clip);
    if (occ.isBlock) blockClips.push(clip);
    else meetingClips.push(clip);
  }
  const meetingMinutes = mergeIntervalMinutes(meetingClips);
  const blockedTaskMinutes = mergeIntervalMinutes(blockClips);
  const occupiedMinutes = mergeIntervalMinutes(allClips);
  const planned = occupiedMinutes + opts.unscheduledEstimateMinutes;
  return {
    availableMinutes,
    meetingMinutes,
    blockedTaskMinutes,
    unscheduledTaskMinutes: opts.unscheduledEstimateMinutes,
    overByMinutes: Math.max(0, planned - availableMinutes),
  };
}

export function dayRangeForPlan(day: string, tz: string): { since: string; until: string } {
  return dayRangeIso(day, tz);
}
