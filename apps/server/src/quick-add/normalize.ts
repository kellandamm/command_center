import { ValidationError } from "../settings";
import { calendarLocalInstant, validDay, zonedParts } from "../calendar/store";

export const QUICK_ADD_TZ = "America/Chicago";
export const MAX_QUICK_ADD_ITEMS = 10;
const MAX_QUICK_ADD_TITLE = 500;
const MAX_QUICK_ADD_NOTES = 2_000;

export type QuickAddKind = "task" | "event";

export interface QuickAddItem {
  version?: 2;
  source?: "board" | "todoist";
  timezone?: string;
  operationId?: string;
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
  source?: "board" | "todoist" | "native" | "google";
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
  if (!validDay(value.slice(0, 10)) || !Number.isFinite(parsed.getTime())) throw new ValidationError("Invalid date or time");
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

/** Unversioned previews retain the original Chicago interpretation. Offset inputs retain their instant. */
export function normalizeQuickAddTime(value: string, tz: string = QUICK_ADD_TZ): string {
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) {
    if (!validDay(trimmed)) throw new ValidationError("Invalid due date");
    return trimmed;
  }
  if (LOCAL_MINUTE.test(trimmed)) {
    localMinuteToIso(trimmed, tz);
    return trimmed;
  }
  if (HAS_TZ.test(trimmed)) return parseInstant(trimmed).toISOString();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d+)?$/.test(trimmed)) {
    const local = trimmed.slice(0, 16);
    localMinuteToIso(local, tz);
    return local;
  }
  throw new ValidationError("Invalid date or time");
}

function instantMs(value: string, tz: string): number {
  if (DATE_ONLY.test(value)) return Date.parse(`${value}T12:00:00Z`);
  if (LOCAL_MINUTE.test(value)) return Date.parse(localMinuteToIso(value, tz));
  return Date.parse(value);
}

function normalizeDue(value: unknown, tz: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ValidationError("Due must be an ISO date or datetime");
  return normalizeQuickAddTime(value, tz);
}

function normalizeEventTimes(body: Record<string, unknown>, tz: string): { start?: string; end?: string; durationMinutes?: number } {
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
  const normalizedStart = start === undefined || start === null || start === "" ? undefined : normalizeDue(String(start), tz);
  let normalizedEnd = end === undefined || end === null || end === "" ? undefined : normalizeDue(String(end), tz);
  if (normalizedStart && durationMinutes && !normalizedEnd) {
    const baseMs = instantMs(normalizedStart, tz);
    normalizedEnd = new Date(baseMs + Number(durationMinutes) * 60_000).toISOString();
  }
  if (normalizedStart && normalizedEnd) {
    const from = instantMs(normalizedStart, tz);
    const to = instantMs(normalizedEnd, tz);
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
  if (body.version !== undefined && body.version !== 2) throw new ValidationError("Unsupported quick-add version");
  if (body.source !== undefined && body.source !== "board" && body.source !== "todoist") throw new ValidationError("Unknown task source");
  if (body.source === "board" && body.version !== 2) throw new ValidationError("Native tasks require a version 2 preview");
  if (body.version === 2 && (typeof body.timezone !== "string" || (kind === "task" && !body.source))) throw new ValidationError("Version 2 previews require timezone and task source");
  const timezone = body.timezone === undefined ? QUICK_ADD_TZ : body.timezone;
  if (typeof timezone !== "string" || /^[+-]/.test(timezone)) throw new ValidationError("Timezone must be a valid IANA zone");
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); }
  catch { throw new ValidationError("Timezone must be a valid IANA zone"); }
  if (body.operationId !== undefined && (typeof body.operationId !== "string" || !/^[a-zA-Z0-9-]{8,100}$/.test(body.operationId))) throw new ValidationError("Invalid quick-add operation id");
  if (body.version === 2 && !body.operationId) throw new ValidationError("Version 2 previews require an operation id");
  const metadata = {
    ...(body.version === 2 ? { version: 2 as const } : {}),
    ...(body.source ? { source: body.source as "board" | "todoist" } : {}),
    ...(body.timezone !== undefined ? { timezone } : {}),
    ...(body.operationId ? { operationId: String(body.operationId) } : {}),
  };
  const title = titleText(body.title);
  const notes = optionalNotes(body.notes);
  if (kind === "task") {
    const due = normalizeDue(body.due, timezone);
    if (body.source === "board" && due && !DATE_ONLY.test(due)) throw new ValidationError("Native Board deadlines are date-only. Use a calendar event for a specific time.");
    if (body.source === "board" && title.length > 200) throw new ValidationError("Board task titles must be at most 200 characters");
    if (body.start !== undefined || body.end !== undefined || body.durationMinutes !== undefined) {
      throw new ValidationError("Tasks cannot include event times");
    }
    return { ...metadata, kind, title, due, notes };
  }
  const times = normalizeEventTimes(body, timezone);
  if (body.version === 2 && !times.start) throw new ValidationError("Events need a start date or time before confirmation");
  if (body.version === 2 && times.start && DATE_ONLY.test(times.start) && (times.durationMinutes || (times.end && !DATE_ONLY.test(times.end)))) throw new ValidationError("All-day events use date-only exclusive start/end dates, not a timed duration");
  if (body.due !== undefined && body.due !== null && body.due !== "") throw new ValidationError("Events use start/end, not due");
  return { ...metadata, kind, title, ...times, notes };
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

export function taskDueForTodoist(due?: string, tz: string = QUICK_ADD_TZ): { dueDate?: string; dueDatetime?: string } {
  if (!due) return {};
  if (DATE_ONLY.test(due)) return { dueDate: due };
  if (LOCAL_MINUTE.test(due)) return { dueDatetime: localMinuteToIso(due, tz) };
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
  if ((item.start && HAS_TZ.test(item.start)) || (item.end && HAS_TZ.test(item.end))) {
    base.start = item.start && HAS_TZ.test(item.start) ? parseInstant(item.start).toISOString() : localMinuteToIso(walls.start, timezone);
    base.end = item.end && HAS_TZ.test(item.end) ? parseInstant(item.end).toISOString() : walls.end ? localMinuteToIso(walls.end, timezone) : undefined;
    if (!base.end) throw new ValidationError("Timed events need an end time or duration");
    return base;
  }
  const startLocal = walls.start;
  let endLocal = walls.end;
  if (!endLocal) throw new ValidationError("Timed events need an end time or duration");
  base.localStart = startLocal;
  base.localEnd = endLocal;
  return base;
}

export function previewFieldsForItem(item: QuickAddItem): QuickAddItem {
  return { ...item };
}
