import { calendarLocalInstant, validDay } from "./store";
import { ValidationError } from "../settings";

function nextDayKey(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function dayRangeIso(day: string, tz: string): { since: string; until: string } {
  if (!validDay(day)) throw new ValidationError("Invalid review day");
  const since = calendarLocalInstant(day, "00:00", tz);
  const until = calendarLocalInstant(nextDayKey(day), "00:00", tz);
  if (!since || !until) throw new ValidationError("The selected day boundary does not exist in this timezone");
  return { since: since.toISOString(), until: until.toISOString() };
}

export function durationMsOnDay(
  spec: { start: Date | string; end: Date | string | null; allDay: boolean; timezone?: string },
  day: string,
  tz: string,
): number {
  if (!spec.end) return 0;
  const range = dayRangeIso(day, tz);
  const dayStart = Date.parse(range.since);
  const dayEnd = Date.parse(range.until);
  const zone = spec.timezone ?? tz;
  let startMs: number;
  let endMs: number;
  if (spec.allDay) {
    const startDay = typeof spec.start === "string" ? spec.start.slice(0, 10) : spec.start.toISOString().slice(0, 10);
    const endDay = typeof spec.end === "string" ? spec.end.slice(0, 10) : spec.end.toISOString().slice(0, 10);
    const start = calendarLocalInstant(startDay, "00:00", zone);
    const end = calendarLocalInstant(endDay, "00:00", zone);
    if (!start || !end) throw new ValidationError("The selected all-day boundary does not exist in this timezone");
    startMs = start.getTime();
    endMs = end.getTime();
  } else {
    startMs = typeof spec.start === "string" ? Date.parse(spec.start) : spec.start.getTime();
    endMs = typeof spec.end === "string" ? Date.parse(spec.end) : spec.end.getTime();
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.min(endMs, dayEnd) - Math.max(startMs, dayStart));
}

export function hoursFromMs(ms: number): number {
  return Math.round((ms / 3_600_000) * 100) / 100;
}
