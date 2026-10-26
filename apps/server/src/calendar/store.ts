import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { readJson, writeFileAtomic } from "../store";
import { ValidationError } from "../settings";
import { tzOffsetMs } from "../scheduler";
import type { CalendarEvent } from "./parse-ics";

export class CalendarConflictError extends Error {}
export interface ManagedCalendar {
  id: string; name: string; kind: "native" | "ics"; color: string; enabled: boolean;
  version: number; createdAt: string; feedKeyHash?: string;
}
export interface StoredEvent {
  id: string; calendarId: string; summary: string; start: string; end: string;
  allDay: boolean; timezone: string; location: string; description: string;
  spaceId: string | null; noteId: string | null; taskId: string | null;
  recurrence: "none" | "daily" | "weekly" | "monthly"; repeatUntil: string | null;
  version: number; createdAt: string; updatedAt: string;
}
interface Data { version: 1; calendars: ManagedCalendar[]; events: StoredEvent[] }
export interface CalendarRange { rangeStart?: Date; rangeEnd?: Date; limit?: number; horizonDays?: number }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Expected an object");
  return value as Record<string, unknown>;
}
export function calendarText(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0") || (required && !value.trim())) throw new ValidationError(`${label} must be text${required ? " and cannot be empty" : ""} (up to ${max} characters)`);
  return value.trim();
}
export function validDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function validInstant(value: string): boolean {
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
    && validDay(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24
    && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60
    && Number.isFinite(Date.parse(value));
}
export function zonedParts(value: string, tz: string): { day: string; time: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
function hash(key: string) { return createHash("sha256").update(key).digest(); }
function localInstant(day: string, time: string, timezone: string): Date | undefined {
  const guess = Date.parse(`${day}T${time}:00Z`);
  const candidates = [-1, 0, 1].map((offset) => new Date(guess - tzOffsetMs(new Date(guess + offset * 86_400_000), timezone)))
    .filter((instant) => {
      const parts = zonedParts(instant.toISOString(), timezone);
      return parts.day === day && parts.time === time;
    });
  return candidates.sort((a, b) => a.getTime() - b.getTime())[0];
}
export function calendarLocalInstant(day: string, time: string, timezone: string): Date | undefined {
  return localInstant(day, time, timezone);
}
function versionCheck(expected: unknown, actual: number) {
  if (expected !== actual) throw new CalendarConflictError("This calendar item changed elsewhere. Refresh before editing; your changes have not been applied.");
}

export class CalendarStore {
  private data: Data = { version: 1, calendars: [], events: [] };
  private queue: Promise<void> = Promise.resolve();
  private constructor(private path: string) {}
  static async open(dataDir: string): Promise<CalendarStore> {
    const store = new CalendarStore(join(dataDir, "calendars.json"));
    const saved = await readJson<Data>(store.path);
    if (saved) {
      if (saved.version !== 1 || !Array.isArray(saved.calendars) || !Array.isArray(saved.events)) throw new Error("Invalid calendars.json; restore a valid backup");
      try {
        if (saved.calendars.length > 50 || saved.events.length > 10_000 || Buffer.byteLength(JSON.stringify(saved)) > 20_000_000) throw new Error("Storage limit exceeded");
        const ids = new Set<string>();
        const identifier = (id: unknown) => {
          if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(id) || ids.has(id)) throw new Error("Invalid or duplicate identifier");
          ids.add(id);
        };
        for (const calendar of saved.calendars) {
          identifier(calendar.id);
          if (!["native", "ics"].includes(calendar.kind) || typeof calendar.enabled !== "boolean"
            || !Number.isSafeInteger(calendar.version) || calendar.version < 1 || !validInstant(calendar.createdAt)
            || typeof calendar.color !== "string" || !/^#[a-f0-9]{6}$/i.test(calendar.color)
            || (calendar.feedKeyHash !== undefined && (calendar.kind !== "native" || !/^[a-f0-9]{64}$/.test(calendar.feedKeyHash)))) throw new Error("Invalid calendar");
          calendarText(calendar.name, "Calendar name", 120, true);
        }
        for (const event of saved.events) {
          identifier(event.id);
          if (!Number.isSafeInteger(event.version) || event.version < 1 || !validInstant(event.createdAt) || !validInstant(event.updatedAt)
            || typeof event.start !== "string" || typeof event.end !== "string" || typeof event.recurrence !== "string") throw new Error("Invalid event");
          store.prepareEvent({ ...saved, events: [] }, { ...event });
        }
      } catch (error) {
        throw new Error("Invalid calendars.json; restore a valid backup", { cause: error });
      }
      store.data = saved;
    }
    return store;
  }
  list(): ManagedCalendar[] {
    return this.data.calendars.map(({ feedKeyHash, ...calendar }) => ({ ...calendar }));
  }
  get(id: string): ManagedCalendar | undefined { return this.list().find((calendar) => calendar.id === id); }
  event(id: string): StoredEvent | undefined {
    const event = this.data.events.find((row) => row.id === id);
    return event ? structuredClone(event) : undefined;
  }
  events(calendarId?: string): StoredEvent[] { return structuredClone(this.data.events.filter((row) => !calendarId || row.calendarId === calendarId)); }
  private commit<T>(change: (next: Data) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const next = structuredClone(this.data);
      const result = change(next);
      const serialized = JSON.stringify(next, null, 2);
      if (next.calendars.length > 50 || next.events.length > 10_000 || Buffer.byteLength(serialized) > 20_000_000) throw new ValidationError("Calendar storage limit reached");
      await writeFileAtomic(this.path, serialized);
      this.data = next;
      return structuredClone(result);
    });
    this.queue = run.then(() => {}, () => {});
    return run;
  }
  create(input: unknown): Promise<ManagedCalendar> {
    const body = object(input);
    if (body.kind !== "native" && body.kind !== "ics") throw new ValidationError("Calendar kind must be native or ics");
    const kind = body.kind;
    const name = calendarText(body.name, "Calendar name", 120, true);
    const color = calendarText(body.color ?? "#2767ad", "Color", 7);
    if (!/^#[a-f0-9]{6}$/i.test(color)) throw new ValidationError("Color must be a six-digit hex color");
    return this.commit((next) => {
      const calendar: ManagedCalendar = { id: randomUUID(), name, kind, color, enabled: true, version: 1, createdAt: new Date().toISOString() };
      next.calendars.push(calendar);
      return calendar;
    });
  }
  update(id: string, input: unknown): Promise<ManagedCalendar> {
    const body = object(input);
    return this.commit((next) => {
      const calendar = next.calendars.find((row) => row.id === id);
      if (!calendar) throw new ValidationError("Calendar not found");
      versionCheck(body.expectedVersion, calendar.version);
      if (body.name !== undefined) calendar.name = calendarText(body.name, "Calendar name", 120, true);
      if (body.color !== undefined) {
        if (typeof body.color !== "string" || !/^#[a-f0-9]{6}$/i.test(body.color)) throw new ValidationError("Color must be a six-digit hex color");
        calendar.color = body.color;
      }
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== "boolean") throw new ValidationError("enabled must be boolean");
        calendar.enabled = body.enabled;
      }
      calendar.version++;
      const { feedKeyHash, ...result } = calendar;
      return result;
    });
  }
  remove(id: string, expectedVersion: unknown) {
    return this.commit((next) => {
      const calendar = next.calendars.find((row) => row.id === id);
      if (!calendar) throw new ValidationError("Calendar not found");
      versionCheck(expectedVersion, calendar.version);
      next.calendars = next.calendars.filter((row) => row.id !== id);
      next.events = next.events.filter((row) => row.calendarId !== id);
    });
  }
  saveEvent(input: unknown, id?: string): Promise<StoredEvent> {
    const body = object(input);
    return this.commit((next) => this.prepareEvent(next, body, id));
  }
  previewEvent(input: unknown, id?: string): StoredEvent {
    return this.prepareEvent(structuredClone(this.data), object(input), id);
  }
  importEvents(calendarId: string, events: Record<string, unknown>[]): Promise<{ imported: number }> {
    return this.commit((next) => {
      let imported = 0;
      for (const body of events) {
        const count = next.events.length;
        const event = this.prepareEvent(next, { ...body, calendarId });
        if (next.events.slice(0, count).some((row) => row.calendarId === calendarId && row.summary === event.summary && row.start === event.start)) next.events.pop();
        else imported++;
      }
      return { imported };
    });
  }
  private prepareEvent(next: Data, body: Record<string, unknown>, id?: string): StoredEvent {
      const existing = id ? next.events.find((row) => row.id === id) : undefined;
      if (id && !existing) throw new ValidationError("Event not found");
      if (existing) versionCheck(body.expectedVersion, existing.version);
      const calendarId = calendarText(body.calendarId ?? existing?.calendarId, "Calendar", 100, true);
      const calendar = next.calendars.find((row) => row.id === calendarId);
      if (!calendar || calendar.kind !== "native") throw new ValidationError("Choose a native calendar; subscriptions are read-only");
      const summary = calendarText(body.summary, "Event title", 240, true);
      if (typeof body.allDay !== "boolean") throw new ValidationError("allDay must be boolean");
      const allDay = body.allDay;
      const timezone = calendarText(body.timezone, "Timezone", 100, true);
      if (/^[+-]/.test(timezone)) throw new ValidationError("Timezone must be a valid IANA zone, not a fixed numeric offset");
      try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); }
      catch { throw new ValidationError("Timezone must be a valid IANA zone"); }
      const wallTime = (value: unknown): string => {
        if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value) || !validDay(value.slice(0, 10)) || value.slice(11) > "23:59" || Number(value.slice(-2)) > 59) throw new ValidationError("Enter a valid local date and time");
        const instant = localInstant(value.slice(0, 10), value.slice(11), timezone);
        if (!instant) throw new ValidationError("That local time does not exist because of a timezone clock change. Choose another time.");
        return instant.toISOString();
      };
      const start = calendarText(!allDay && body.localStart !== undefined ? wallTime(body.localStart) : body.start, "Start", 40, true);
      const end = calendarText(!allDay && body.localEnd !== undefined ? wallTime(body.localEnd) : body.end, "End", 40, true);
      if (allDay ? !validDay(start) || !validDay(end) : !validInstant(start) || !validInstant(end)) throw new ValidationError("Use valid date-only values for all-day events and UTC timestamps for timed events");
      const from = Date.parse(start), to = Date.parse(end);
      if (!allDay && (!validDay(start.slice(0, 10)) || !validDay(end.slice(0, 10)))) throw new ValidationError("Start and end must be real dates");
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 366 * 86_400_000) throw new ValidationError("Event end must follow start (maximum duration: 366 days)");
      const recurrence = body.recurrence ?? "none";
      if (!["none", "daily", "weekly", "monthly"].includes(String(recurrence))) throw new ValidationError("Unsupported recurrence");
      const repeatUntil = recurrence === "none" ? null : body.repeatUntil;
      const startDay = allDay ? start : zonedParts(start, timezone).day;
      if (recurrence !== "none" && (!validDay(repeatUntil) || repeatUntil < startDay || Date.parse(repeatUntil) - Date.parse(startDay) > 366 * 86_400_000)) throw new ValidationError("Recurring events need an end date within 366 days of the first event");
      const reference = (key: string) => body[key] == null || body[key] === "" ? null : calendarText(body[key], key, 100, true);
      const now = new Date().toISOString();
      const event: StoredEvent = {
        id: existing?.id ?? randomUUID(), calendarId, summary,
        start: allDay ? start : new Date(start).toISOString(), end: allDay ? end : new Date(end).toISOString(), allDay, timezone,
        location: calendarText(body.location ?? "", "Location", 2000),
        description: calendarText(body.description ?? "", "Description", 20_000),
        spaceId: reference("spaceId"), noteId: reference("noteId"), taskId: reference("taskId"),
        recurrence: recurrence as StoredEvent["recurrence"], repeatUntil: repeatUntil as string | null,
        version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
      };
      if (existing) next.events[next.events.indexOf(existing)] = event;
      else next.events.push(event);
      return event;
  }
  deleteEvent(id: string, expectedVersion: unknown) {
    return this.commit((next) => {
      const event = next.events.find((row) => row.id === id);
      if (!event) throw new ValidationError("Event not found");
      versionCheck(expectedVersion, event.version);
      next.events = next.events.filter((row) => row.id !== id);
    });
  }
  async publish(id: string, expectedVersion: unknown): Promise<string> {
    const key = randomBytes(32).toString("hex");
    await this.commit((next) => {
      const calendar = next.calendars.find((row) => row.id === id);
      if (!calendar || calendar.kind !== "native") throw new ValidationError("Only native calendars can be published");
      versionCheck(expectedVersion, calendar.version);
      calendar.feedKeyHash = hash(key).toString("hex");
      calendar.version++;
    });
    return key;
  }
  async unpublish(id: string, expectedVersion: unknown) {
    await this.commit((next) => {
      const calendar = next.calendars.find((row) => row.id === id);
      if (!calendar) throw new ValidationError("Calendar not found");
      versionCheck(expectedVersion, calendar.version);
      delete calendar.feedKeyHash;
      calendar.version++;
    });
  }
  published(id: string, key: string): boolean {
    const calendar = this.data.calendars.find((row) => row.id === id);
    return !!calendar?.enabled && calendar.kind === "native" && !!calendar.feedKeyHash
      && timingSafeEqual(hash(key), Buffer.from(calendar.feedKeyHash, "hex"));
  }
  sharing(id: string): boolean { return !!this.data.calendars.find((row) => row.id === id)?.feedKeyHash; }
  occurrences(rangeStart: Date, rangeEnd: Date, options: { calendarId?: string; eventId?: string; includeDisabled?: boolean } = {}): CalendarEvent[] {
    const result: CalendarEvent[] = [];
    const enabled = new Set(this.data.calendars.filter((row) => (row.enabled || options.includeDisabled) && row.kind === "native").map((row) => row.id));
    for (const event of this.data.events) {
      if (!enabled.has(event.calendarId) || (options.calendarId && event.calendarId !== options.calendarId) || (options.eventId && event.id !== options.eventId)) continue;
      const start = event.allDay ? { day: event.start, time: "00:00" } : zonedParts(event.start, event.timezone);
      for (let index = 0; index < 367; index++) {
        if (index && event.recurrence === "none") break;
        const day = new Date(`${start.day}T00:00:00Z`);
        if (event.recurrence === "monthly") {
          day.setUTCDate(1); day.setUTCMonth(day.getUTCMonth() + index);
          const month = day.getUTCMonth(); day.setUTCDate(Number(start.day.slice(-2)));
          if (day.getUTCMonth() !== month) continue;
        } else day.setUTCDate(day.getUTCDate() + index * (event.recurrence === "weekly" ? 7 : 1));
        const key = day.toISOString().slice(0, 10);
        if (event.repeatUntil && key > event.repeatUntil) break;
        let at = event.allDay ? day : localInstant(key, start.time, event.timezone);
        if (!at) continue;
        if (!event.allDay) at = new Date(at.getTime() + ((Date.parse(event.start) % 60_000) + 60_000) % 60_000);
        if (index === 0 && !event.allDay) at = new Date(event.start);
        // Skip nonexistent DST wall times instead of shifting the event silently.
        if (!event.allDay && zonedParts(at.toISOString(), event.timezone).time !== start.time) continue;
        const end = new Date(at.getTime() + Date.parse(event.end) - Date.parse(event.start));
        if (at >= rangeEnd) break;
        if (end <= rangeStart) continue;
        result.push({
          uid: `${event.id}:${key}`, eventId: event.id, calendarId: event.calendarId, summary: event.summary,
          start: at, end, allDay: event.allDay, timezone: event.timezone, location: event.location, description: event.description,
          readOnly: false, version: event.version, recurrence: event.recurrence,
          url: event.noteId ? `/notes?note=${encodeURIComponent(event.noteId)}` : undefined,
        });
      }
    }
    return result.sort((a, b) => a.start.getTime() - b.start.getTime());
  }
}
