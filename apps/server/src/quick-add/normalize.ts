import { ValidationError } from "../settings";
import { calendarLocalInstant, zonedParts } from "../calendar/store";

export const QUICK_ADD_TZ = "America/Chicago";
export const MAX_QUICK_ADD_ITEMS = 10;
const MAX_QUICK_ADD_TITLE = 500;
const MAX_QUICK_ADD_NOTES = 2_000;

export type QuickAddKind = "task" | "event";

export interface QuickAddItem {
  kind: QuickAddKind;
  title: string;
  due?: string;
  start?: string;
  end?: string;
  durationMinutes?: number;
  notes?: string;
}

export interface QuickAddCommitItem extends QuickAddItem {
  calendarId?: string;
}

export interface QuickAddCommitResult {
  kind: QuickAddKind;
  title: string;
  url: string;
  id: string;
}

export interface QuickAddCommitFailure {
  index: number;
  title: string;
  error: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const HAS_TZ = /(?:Z|[+-]\d{2}:\d{2})$/i;

function addCalendarDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Expected an object");
  return value as Record<string, unknown>;
}

function titleText(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("Each item needs a title");
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_QUICK_ADD_TITLE) throw new ValidationError("Title must be text (up to 500 characters)");
  return trimmed;
}

function optionalNotes(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ValidationError("Notes must be text");
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_QUICK_ADD_NOTES) throw new ValidationError("Notes are too long");
  return trimmed;
}

function parseInstant(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new ValidationError("Invalid date or time");
  return parsed;
}

export function toLocalMinute(instant: Date, tz: string): string {
  const parts = zonedParts(instant.toISOString(), tz);
  return `${parts.day}T${parts.time}`;
}

export function localMinuteToIso(local: string, tz: string): string {
  const instant = calendarLocalInstant(local.slice(0, 10), local.slice(11), tz);
  if (!instant) throw new ValidationError("That local time does not exist in the chosen timezone");
  return instant.toISOString();
}

/** Normalize a date/time string to Chicago wall (YYYY-MM-DD or YYYY-MM-DDTHH:mm) or UTC ISO for offset/Z inputs. */
export function normalizeQuickAddTime(value: string, tz: string = QUICK_ADD_TZ): string {
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) {
    if (!Number.isFinite(Date.parse(`${trimmed}T12:00:00Z`))) throw new ValidationError("Invalid due date");
    return trimmed;
  }
  if (LOCAL_MINUTE.test(trimmed)) return trimmed;
  if (HAS_TZ.test(trimmed)) return toLocalMinute(parseInstant(trimmed), tz);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
    const local = trimmed.slice(0, 16);
    if (LOCAL_MINUTE.test(local)) return local;
  }
  throw new ValidationError("Invalid date or time");
}

function instantMs(value: string, tz: string): number {
  if (DATE_ONLY.test(value)) return Date.parse(`${value}T12:00:00Z`);
  if (LOCAL_MINUTE.test(value)) return Date.parse(localMinuteToIso(value, tz));
  return Date.parse(value);
}

function normalizeDue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ValidationError("Due must be an ISO date or datetime");
  return normalizeQuickAddTime(value, QUICK_ADD_TZ);
}

function normalizeEventTimes(body: Record<string, unknown>): { start?: string; end?: string; durationMinutes?: number } {
  let start = body.start;
  let end = body.end;
  let durationMinutes = body.durationMinutes;
  if (durationMinutes !== undefined && durationMinutes !== null) {
    if (typeof durationMinutes !== "number" || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      throw new ValidationError("durationMinutes must be a whole number from 1 to 1440");
    }
  } else {
    durationMinutes = undefined;
  }
  const normalizedStart = start === undefined || start === null || start === "" ? undefined : normalizeDue(String(start));
  let normalizedEnd = end === undefined || end === null || end === "" ? undefined : normalizeDue(String(end));
  if (normalizedStart && durationMinutes && !normalizedEnd) {
    const baseMs = instantMs(normalizedStart, QUICK_ADD_TZ);
    normalizedEnd = toLocalMinute(new Date(baseMs + Number(durationMinutes) * 60_000), QUICK_ADD_TZ);
  }
  if (normalizedStart && normalizedEnd) {
    const from = instantMs(normalizedStart, QUICK_ADD_TZ);
    const to = instantMs(normalizedEnd, QUICK_ADD_TZ);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new ValidationError("Event end must follow start");
  }
  return {
    start: normalizedStart,
    end: normalizedEnd,
    durationMinutes: durationMinutes as number | undefined,
  };
}

export function normalizeQuickAddItem(raw: unknown): QuickAddItem {
  const body = object(raw);
  const kind = body.kind;
  if (kind !== "task" && kind !== "event") throw new ValidationError("Item kind must be task or event");
  const title = titleText(body.title);
  const notes = optionalNotes(body.notes);
  if (kind === "task") {
    const due = normalizeDue(body.due);
    if (body.start !== undefined || body.end !== undefined || body.durationMinutes !== undefined) {
      throw new ValidationError("Tasks cannot include event times");
    }
    return { kind, title, due, notes };
  }
  const times = normalizeEventTimes(body);
  if (body.due !== undefined && body.due !== null && body.due !== "") throw new ValidationError("Events use start/end, not due");
  return { kind, title, ...times, notes };
}

export function parseQuickAddPayload(value: unknown): QuickAddItem[] {
  const body = object(value);
  const items = body.items;
  if (!Array.isArray(items)) throw new ValidationError("Expected items array");
  if (!items.length) throw new ValidationError("Add at least one item");
  if (items.length > MAX_QUICK_ADD_ITEMS) throw new ValidationError(`At most ${MAX_QUICK_ADD_ITEMS} items per quick add`);
  return items.map((item) => normalizeQuickAddItem(item));
}

export function extractJsonObject(text: string): unknown {
  let trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fence) trimmed = fence[1]!.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ValidationError("LLM response was not valid JSON");
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new ValidationError("LLM response was not valid JSON");
  }
}

export function taskDueForTodoist(due?: string): { dueDate?: string; dueDatetime?: string } {
  if (!due) return {};
  if (DATE_ONLY.test(due)) return { dueDate: due };
  if (LOCAL_MINUTE.test(due)) return { dueDatetime: localMinuteToIso(due, QUICK_ADD_TZ) };
  return { dueDatetime: due };
}

export function wallTimesForItem(item: QuickAddItem, tz: string = QUICK_ADD_TZ): { start?: string; end?: string; due?: string } {
  const due = item.due && !DATE_ONLY.test(item.due) && !LOCAL_MINUTE.test(item.due)
    ? toLocalMinute(parseInstant(item.due), tz)
    : item.due;
  if (item.kind === "task") return { due };
  if (!item.start || DATE_ONLY.test(item.start)) return { start: item.start, end: item.end };
  const start = LOCAL_MINUTE.test(item.start) ? item.start : toLocalMinute(parseInstant(item.start), tz);
  let end = item.end
    ? (LOCAL_MINUTE.test(item.end) ? item.end : toLocalMinute(parseInstant(item.end), tz))
    : undefined;
  if (!end && item.durationMinutes) {
    end = toLocalMinute(
      new Date(Date.parse(localMinuteToIso(start, tz)) + item.durationMinutes * 60_000),
      tz,
    );
  }
  return { start, end };
}

export function eventPayloadFromItem(item: QuickAddItem, calendarId: string, timezone: string): Record<string, unknown> {
  const walls = wallTimesForItem(item, timezone);
  const base: Record<string, unknown> = {
    calendarId,
    summary: item.title,
    description: item.notes ?? "",
    location: "",
    recurrence: "none",
    timezone,
  };
  if (!walls.start) {
    const day = zonedParts(new Date().toISOString(), timezone).day;
    base.allDay = true;
    base.start = day;
    base.end = addCalendarDay(day);
    return base;
  }
  if (DATE_ONLY.test(walls.start)) {
    base.allDay = true;
    base.start = walls.start;
    const endDay = walls.end && DATE_ONLY.test(walls.end) ? walls.end : addCalendarDay(walls.start);
    base.end = endDay <= walls.start ? addCalendarDay(walls.start) : endDay;
    return base;
  }
  base.allDay = false;
  const startLocal = walls.start;
  let endLocal = walls.end;
  if (!endLocal) throw new ValidationError("Timed events need an end time or duration");
  base.localStart = startLocal;
  base.localEnd = endLocal;
  return base;
}

export function previewFieldsForItem(item: QuickAddItem): QuickAddItem {
  const walls = wallTimesForItem(item, QUICK_ADD_TZ);
  if (item.kind === "task") return { ...item, due: walls.due ?? item.due };
  return { ...item, start: walls.start ?? item.start, end: walls.end ?? item.end };
}
