import { slotInstant } from "../scheduler";

export interface CalendarEvent {
  uid: string;
  summary: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  timezone?: string;
  location: string | null;
  description?: string | null;
  url?: string | null;
  calendarId?: string;
  eventId?: string;
  readOnly?: boolean;
  version?: number;
  recurrence?: string;
  syncVersion?: string;
}

function unfoldIcs(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of raw) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      if (lines.length) lines[lines.length - 1] += line.slice(1);
      else lines.push(line.trimStart());
    } else lines.push(line);
  }
  return lines;
}

function parseIcsDate(value: string, tz: string): { date: Date; allDay: boolean } {
  const v = value.trim();
  if (/^\d{8}$/.test(v)) {
    const y = Number(v.slice(0, 4));
    const m = Number(v.slice(4, 6)) - 1;
    const d = Number(v.slice(6, 8));
    const date = new Date(Date.UTC(y, m, d, 12, 0, 0));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m || date.getUTCDate() !== d) throw new Error("Invalid calendar date");
    return { date, allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) throw new Error(`unsupported DTSTART/DTEND: ${value}`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6]);
  const check = new Date(Date.UTC(y, mo, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo || check.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) throw new Error("Invalid calendar date or time");
  if (m[7] === "Z") return { date: new Date(Date.UTC(y, mo, d, h, mi, s)), allDay: false };
  const day = `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const hhmm = `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  const date = new Date(slotInstant(day, hhmm, tz).getTime() + s * 1_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` !== `${day}T${hhmm}`) throw new Error("Nonexistent local calendar time");
  return { date, allDay: false };
}

function propValue(line: string): { name: string; value: string; timezone?: string } {
  const idx = line.indexOf(":");
  if (idx < 0) return { name: line.toUpperCase(), value: "" };
  const head = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const name = head.split(";")[0]!.toUpperCase();
  const timezone = head.match(/;TZID=(?:"([^"]+)"|([^;]+))/i);
  return { name, value, timezone: timezone?.[1] ?? timezone?.[2] };
}

/** Parse VEVENT blocks from iCalendar text. */
export function parseIcsEvents(icsText: string, tz: string, now = new Date(), strict = false): CalendarEvent[] {
  const lines = unfoldIcs(icsText);
  const events: CalendarEvent[] = [];
  let inEvent = false;
  let cur: Partial<CalendarEvent> & { startRaw?: string; endRaw?: string; startTimezone?: string; endTimezone?: string } = {};

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      inEvent = true;
      cur = {};
      continue;
    }
    if (upper === "END:VEVENT") {
      inEvent = false;
      if (cur.startRaw && cur.summary) {
        try {
          const { date: start, allDay } = parseIcsDate(cur.startRaw, cur.startTimezone ?? tz);
          let end: Date | null = null;
          if (cur.endRaw) {
            const parsedEnd = parseIcsDate(cur.endRaw, cur.endTimezone ?? cur.startTimezone ?? tz);
            if (strict && parsedEnd.allDay !== allDay) throw new Error("Mixed event date types");
            end = parsedEnd.date;
          }
          if (strict && ((end && end <= start) || (!end && !allDay))) throw new Error("Timed imports require an explicit end after their start");
          if (!end || end <= start) end = new Date(start.getTime() + (allDay ? 86_400_000 : 3_600_000));
          if (end >= now) {
            events.push({
              uid: cur.uid ?? `${cur.summary}-${start.toISOString()}`,
              summary: cur.summary,
              start,
              end,
              allDay,
              location: cur.location ?? null,
              description: cur.description ?? null,
              url: cur.url ?? null,
            });
          }
        } catch (error) {
          if (strict) throw error;
          /* skip malformed event */
        }
      }
      continue;
    }
    if (!inEvent) continue;
    const { name, value, timezone } = propValue(line);
    if (name === "UID") cur.uid = value;
    const textValue = () => value.replace(/\\([nN,;\\])/g, (_, escaped: string) => /n/i.test(escaped) ? "\n" : escaped);
    if (name === "SUMMARY") cur.summary = textValue().replace(/\n/g, " ");
    if (name === "LOCATION") cur.location = textValue().replace(/\n/g, " ");
    if (name === "DESCRIPTION") cur.description = textValue();
    if (name === "URL") cur.url = value;
    if (name === "DTSTART") { cur.startRaw = value; cur.startTimezone = timezone; }
    if (name === "DTEND") { cur.endRaw = value; cur.endTimezone = timezone; }
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return events;
}

export function upcomingEvents(events: CalendarEvent[], limit = 12, horizonDays = 14, now = new Date()): CalendarEvent[] {
  const horizon = now.getTime() + horizonDays * 86_400_000;
  return events.filter((e) => e.start.getTime() <= horizon).slice(0, limit);
}
