import { readFile } from "node:fs/promises";
import { safeFetch, BlockedUrlError } from "../ssrf";
import { parseIcsEvents, upcomingEvents, type CalendarEvent } from "./parse-ics";

export interface CalendarFeedResult {
  url: string;
  ok: boolean;
  error?: string;
  eventCount: number;
}

export interface CalendarSnapshot {
  configured: boolean;
  feeds: CalendarFeedResult[];
  events: CalendarEvent[];
}

export async function fetchCalendarEvents(
  urls: string[],
  tz: string,
  opts: { limit?: number; horizonDays?: number; localFiles?: string[] } = {},
): Promise<CalendarSnapshot> {
  const localFiles = opts.localFiles ?? [];
  if (!urls.length && !localFiles.length) {
    return { configured: false, feeds: [], events: [] };
  }
  const all: CalendarEvent[] = [];
  const feeds: CalendarFeedResult[] = [];
  const now = new Date();

  for (const filePath of localFiles) {
    const label = `file:${filePath}`;
    try {
      const body = await readFile(filePath, "utf8");
      const parsed = parseIcsEvents(body, tz, now);
      all.push(...parsed);
      feeds.push({ url: label, ok: true, eventCount: parsed.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "read failed";
      feeds.push({ url: label, ok: false, error: msg, eventCount: 0 });
    }
  }

  for (const url of urls) {
    try {
      const { status, body } = await safeFetch(url, { timeoutMs: 20_000, maxBytes: 2_000_000 });
      if (status < 200 || status >= 300) {
        feeds.push({ url, ok: false, error: `HTTP ${status}`, eventCount: 0 });
        continue;
      }
      const parsed = parseIcsEvents(body, tz, now);
      all.push(...parsed);
      feeds.push({ url, ok: true, eventCount: parsed.length });
    } catch (err) {
      const msg = err instanceof BlockedUrlError ? err.message : err instanceof Error ? err.message : "fetch failed";
      feeds.push({ url, ok: false, error: msg, eventCount: 0 });
    }
  }

  all.sort((a, b) => a.start.getTime() - b.start.getTime());
  const events = upcomingEvents(all, opts.limit ?? 12, opts.horizonDays ?? 14, now);
  return { configured: true, feeds, events };
}
