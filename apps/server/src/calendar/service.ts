import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { safeFetch, BlockedUrlError } from "../ssrf";
import { parseIcsEvents, upcomingEvents, type CalendarEvent } from "./parse-ics";

export interface CalendarFeedResult {
  url: string;
  ok: boolean;
  error?: string;
  eventCount: number;
  id?: string;
  name?: string;
  color?: string;
  readOnly?: boolean;
}

export interface CalendarSnapshot {
  configured: boolean;
  feeds: CalendarFeedResult[];
  events: CalendarEvent[];
  timezone?: string;
  truncated?: boolean;
}

function calendarName(body: string, fallback: string): string {
  return body.replace(/\r?\n[ \t]/g, "").match(/^X-WR-CALNAME(?:;[^:]*)?:(.+)$/im)?.[1]
    ?.replace(/\\,/g, ",").replace(/\\n/gi, " ").trim().slice(0, 160) || fallback;
}

export async function fetchCalendarEvents(
  urls: string[],
  tz: string,
  opts: { limit?: number; horizonDays?: number; localFiles?: string[]; rangeStart?: Date; rangeEnd?: Date } = {},
): Promise<CalendarSnapshot> {
  const localFiles = opts.localFiles ?? [];
  if (!urls.length && !localFiles.length) {
    return { configured: false, feeds: [], events: [], timezone: tz };
  }
  const all: CalendarEvent[] = [];
  const feeds: CalendarFeedResult[] = [];
  const now = new Date();
  const parseFrom = opts.rangeStart ?? now;
  const calendarId = (source: string) => createHash("sha256").update(source).digest("hex").slice(0, 16);

  for (const filePath of localFiles) {
    const label = `file:${filePath}`;
    const id = calendarId(label);
    let name = `Local calendar ${localFiles.indexOf(filePath) + 1}`;
    try {
      const body = await readFile(filePath, "utf8");
      name = calendarName(body, name);
      const parsed = parseIcsEvents(body, tz, parseFrom);
      all.push(...parsed.map((event) => ({ ...event, calendarId: id })));
      feeds.push({ url: label, id, name, ok: true, eventCount: parsed.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "read failed";
      feeds.push({ url: label, id, name, ok: false, error: msg, eventCount: 0 });
    }
  }

  for (const url of urls) {
    const id = calendarId(url);
    let name = `Calendar ${urls.indexOf(url) + 1}`;
    try {
      const { status, body } = await safeFetch(url, { timeoutMs: 20_000, maxBytes: 2_000_000 });
      if (status < 200 || status >= 300) {
        feeds.push({ url, id, name, ok: false, error: `HTTP ${status}`, eventCount: 0 });
        continue;
      }
      name = calendarName(body, name);
      const parsed = parseIcsEvents(body, tz, parseFrom);
      all.push(...parsed.map((event) => ({ ...event, calendarId: id })));
      feeds.push({ url, id, name, ok: true, eventCount: parsed.length });
    } catch (err) {
      const msg = err instanceof BlockedUrlError ? err.message : err instanceof Error ? err.message : "fetch failed";
      feeds.push({ url, id, name, ok: false, error: msg, eventCount: 0 });
    }
  }

  all.sort((a, b) => a.start.getTime() - b.start.getTime());
  const inRange = opts.rangeStart && opts.rangeEnd
    ? all.filter((event) => {
      const start = event.allDay ? new Date(`${event.start.toISOString().slice(0, 10)}T00:00:00Z`) : event.start;
      const end = event.allDay && event.end ? new Date(`${event.end.toISOString().slice(0, 10)}T00:00:00Z`) : event.end;
      return start < opts.rangeEnd! && (end ?? start) > opts.rangeStart!;
    })
    : upcomingEvents(all, Number.MAX_SAFE_INTEGER, opts.horizonDays ?? 14, now);
  const limit = opts.limit ?? 12;
  return { configured: true, feeds, events: inRange.slice(0, limit), timezone: tz, truncated: inRange.length > limit };
}
