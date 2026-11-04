import { ValidationError } from "../settings";
import { dayKey } from "../store";
import { calendarLocalInstant } from "../calendar/store";
import { DEFAULT_WORK_END, DEFAULT_WORK_START } from "./planner";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class DayPlanNotFoundError extends Error {
  constructor() {
    super("No plan for that day.");
  }
}

/** Calendar day in cfg.tz, or null if malformed / impossible (e.g. 2026-02-30). */
export function parseCalendarDay(value: string): string | null {
  if (!DAY_RE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y!, m! - 1, d!));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m! - 1 || probe.getUTCDate() !== d!) return null;
  return value;
}

export function dayParamFromQuery(param: string | null, tz: string, now: Date): string {
  if (param === null) return dayKey(now, tz);
  if (param === "") throw new ValidationError("Invalid day.");
  const day = parseCalendarDay(param);
  if (!day) throw new ValidationError("Invalid day.");
  assertDayInPlanRange(day, now, tz);
  return day;
}

export function dayFromBodyField(value: unknown, tz: string, now: Date): string {
  if (value === undefined) return dayKey(now, tz);
  if (typeof value !== "string") throw new ValidationError("Invalid day.");
  const day = parseCalendarDay(value);
  if (!day) throw new ValidationError("Invalid day.");
  assertDayInPlanRange(day, now, tz);
  return day;
}

export function assertDayInPlanRange(day: string, now: Date, tz: string): void {
  const today = dayKey(now, tz);
  const min = shiftCalendarDay(today, -30);
  const max = shiftCalendarDay(today, 60);
  if (day < min || day > max) throw new ValidationError("Day out of allowed range.");
}

function shiftCalendarDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export function parseWorkTime(value: string): boolean {
  return TIME.test(value);
}

export function assertValidWorkWindow(workStart: string, workEnd: string, day: string, tz: string): void {
  if (!parseWorkTime(workStart) || !parseWorkTime(workEnd)) throw new ValidationError("Invalid work time.");
  const start = calendarLocalInstant(day, workStart, tz);
  const end = calendarLocalInstant(day, workEnd, tz);
  if (!start || !end) throw new ValidationError("Invalid work time.");
  if (end.getTime() <= start.getTime()) throw new ValidationError("Work window end must be after start.");
}

export function parseMustDoSlotBody(body: unknown, tz: string, now: Date): { day: string; slot: number } {
  return parseMustDoActionBody(body, tz, now);
}

export const MUST_DO_REF_ID_MAX_LENGTH = 128;

export interface MustDoRemoteTaskBody {
  source: "board" | "todoist";
  refId: string;
  /** Echoed from 409 JSON; ignored on reopen — server uses stored column only. */
  boardReopenColumn?: string | null;
}

export function parseMustDoActionBody(
  body: unknown,
  tz: string,
  now: Date,
): { day: string; slot: number; remoteTask?: MustDoRemoteTaskBody } {
  if (typeof body !== "object" || body === null) throw new ValidationError("Invalid must-do payload.");
  const o = body as Record<string, unknown>;
  const day = dayFromBodyField(o.day, tz, now);
  if (typeof o.slot !== "number" || !Number.isInteger(o.slot) || o.slot < 0 || o.slot > 2) {
    throw new ValidationError("Invalid must-do slot.");
  }
  let remoteTask: MustDoRemoteTaskBody | undefined;
  if ("remoteTask" in o && o.remoteTask !== undefined) {
    if (typeof o.remoteTask !== "object" || o.remoteTask === null) throw new ValidationError("Invalid remote task.");
    const rt = o.remoteTask as Record<string, unknown>;
    if (rt.source !== "board" && rt.source !== "todoist") throw new ValidationError("Invalid remote task.");
    if (typeof rt.refId !== "string" || !rt.refId.trim()) throw new ValidationError("Invalid remote task.");
    const refId = rt.refId.trim();
    if (refId.length > MUST_DO_REF_ID_MAX_LENGTH) throw new ValidationError("Invalid remote task.");
    remoteTask = { source: rt.source, refId };
    if ("boardReopenColumn" in rt) {
      if (rt.boardReopenColumn !== null && typeof rt.boardReopenColumn !== "string") {
        throw new ValidationError("Invalid remote task.");
      }
      remoteTask.boardReopenColumn = rt.boardReopenColumn as string | null;
    }
  }
  return { day, slot: o.slot, remoteTask };
}

export interface DayPlanPutPatch {
  day: string;
  workStart?: string;
  workEnd?: string;
  weekendOverride?: boolean;
}

export function parseDayPlanPutBody(body: unknown, tz: string, now: Date): DayPlanPutPatch {
  if (typeof body !== "object" || body === null) throw new ValidationError("Invalid day plan payload.");
  const o = body as Record<string, unknown>;
  if (typeof o.day !== "string") throw new ValidationError("Invalid day plan payload.");
  const day = parseCalendarDay(o.day);
  if (!day) throw new ValidationError("Invalid day.");
  assertDayInPlanRange(day, now, tz);

  const patch: DayPlanPutPatch = { day };
  if ("workStart" in o) {
    if (typeof o.workStart !== "string" || !parseWorkTime(o.workStart)) throw new ValidationError("Invalid work time.");
    patch.workStart = o.workStart;
  }
  if ("workEnd" in o) {
    if (typeof o.workEnd !== "string" || !parseWorkTime(o.workEnd)) throw new ValidationError("Invalid work time.");
    patch.workEnd = o.workEnd;
  }
  if ("weekendOverride" in o) {
    if (typeof o.weekendOverride !== "boolean") throw new ValidationError("weekendOverride must be a boolean.");
    patch.weekendOverride = o.weekendOverride;
  }
  return patch;
}

export function resolvePlanPrefs(
  existing: { workStart: string; workEnd: string; weekendOverride: boolean } | null,
  patch: { workStart?: string; workEnd?: string; weekendOverride?: boolean },
): { workStart: string; workEnd: string; weekendOverride: boolean } {
  return {
    workStart: patch.workStart ?? existing?.workStart ?? DEFAULT_WORK_START,
    workEnd: patch.workEnd ?? existing?.workEnd ?? DEFAULT_WORK_END,
    weekendOverride: patch.weekendOverride !== undefined ? patch.weekendOverride : (existing?.weekendOverride ?? false),
  };
}
