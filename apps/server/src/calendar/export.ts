import { slotInstant } from "../scheduler";
import type { CalendarStore, StoredEvent } from "./store";

const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
const instant = (value: string) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
function fold(line: string): string {
  let result = "", current = "";
  for (const character of line) {
    if (Buffer.byteLength(current + character) > 73) { result += current + "\r\n"; current = " "; }
    current += character;
  }
  return result + current;
}
function eventLines(event: StoredEvent): string[] {
  const lines = [
    "BEGIN:VEVENT", `UID:${event.id}@command-center`, `DTSTAMP:${instant(event.updatedAt)}`,
    `SEQUENCE:${event.version}`, `SUMMARY:${escape(event.summary)}`,
    event.allDay ? `DTSTART;VALUE=DATE:${event.start.replace(/-/g, "")}` : `DTSTART:${instant(event.start)}`,
    event.allDay ? `DTEND;VALUE=DATE:${event.end.replace(/-/g, "")}` : `DTEND:${instant(event.end)}`,
    `DESCRIPTION:${escape(event.description)}`, `LOCATION:${escape(event.location)}`,
  ];
  if (event.recurrence !== "none" && event.repeatUntil) {
    // Export explicit occurrences below instead of a UTC RRULE: it would change
    // local wall time across DST without a complete VTIMEZONE definition.
    throw new Error("Recurring events must be expanded before export");
  }
  return [...lines, "END:VEVENT"];
}
export function exportCalendar(store: CalendarStore, id: string): string {
  const calendar = store.get(id);
  if (!calendar || calendar.kind !== "native") throw new Error("Native calendar not found");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Command Center//Calendar//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escape(calendar.name)}`];
  for (const event of store.events(id)) {
    if (event.recurrence === "none") lines.push(...eventLines(event));
    else {
      const start = new Date(event.allDay ? `${event.start}T00:00:00Z` : event.start);
      const end = event.allDay ? new Date(Date.parse(event.repeatUntil!) + 86_400_000) : new Date(slotInstant(event.repeatUntil!, "23:59", event.timezone).getTime() + 60_000);
      for (const occurrence of store.occurrences(start, end, { calendarId: id, eventId: event.id, includeDisabled: true })) {
        lines.push(...eventLines({
          ...event, id: occurrence.uid, recurrence: "none", repeatUntil: null,
          start: event.allDay ? occurrence.start.toISOString().slice(0, 10) : occurrence.start.toISOString(),
          end: event.allDay ? occurrence.end!.toISOString().slice(0, 10) : occurrence.end!.toISOString(),
        }));
      }
    }
  }
  return [...lines, "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}
