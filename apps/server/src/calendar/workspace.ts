import type { Config } from "../config";
import type { ConnectionsStore } from "../connections";
import { fetchCalendarEvents, type CalendarSnapshot } from "./service";
import { CalendarStore, calendarText, object, type CalendarRange } from "./store";
import { parseIcsEvents, type CalendarEvent } from "./parse-ics";
import { ValidationError } from "../settings";
import { assertPublicUrl } from "../ssrf";
import { GoogleCalendarConnector } from "./google";
import type { NotesStore } from "../notes/store";
import type { BoardStore } from "../board/store";

export class CalendarWorkspace {
  readonly google: GoogleCalendarConnector;
  private constructor(readonly store: CalendarStore, private cfg: Config, private vault?: ConnectionsStore, private references?: { notes: NotesStore; board: BoardStore }) {
    this.google = new GoogleCalendarConnector(cfg, vault);
  }
  static async open(cfg: Config, vault?: ConnectionsStore, references?: { notes: NotesStore; board: BoardStore }) {
    return new CalendarWorkspace(await CalendarStore.open(cfg.dataDir), cfg, vault, references);
  }
  status() {
    return {
      timezone: this.cfg.tz, credentialsWritable: this.vault?.status().writable ?? false,
      google: this.google.status(),
      calendars: this.store.list().map((calendar) => ({
        ...calendar, sharing: this.store.sharing(calendar.id),
        credentialConfigured: calendar.kind === "ics" ? !!this.vault?.secret(`calendar/${calendar.id}`) : undefined,
      })),
      environmentFeeds: this.cfg.icsUrls.length + this.cfg.icsLocalFiles.length,
    };
  }
  async googleCalendars() {
    if (!this.google.status().connected) return { calendars: [], selected: [] };
    const calendars = await this.google.listCalendars();
    const selectedIds = new Set(this.google.status().selectedCalendars.map((calendar) => calendar.id));
    return {
      calendars: calendars.map(({ googleId: _googleId, ...calendar }) => ({ ...calendar, selected: selectedIds.has(calendar.id) })),
      selected: this.google.status().selectedCalendars,
    };
  }
  async snapshotGoogle(options: CalendarRange) { return this.google.snapshot(options); }
  async saveEvent(input: unknown, id?: string) {
    const body = object(input);
    if (id?.startsWith("google-") || (typeof body.calendarId === "string" && body.calendarId.startsWith("google-"))) {
      if (body.recurrence && body.recurrence !== "none") throw new ValidationError("Google Calendar recurring events are not supported by this editor yet.");
      if (body.noteId || body.spaceId || body.taskId) throw new ValidationError("Google Calendar events cannot be linked to local notes, Spaces, or tasks.");
      return (await this.google.saveEvent(body, id)).event;
    }
    for (const key of ["noteId", "spaceId", "taskId"] as const) {
      if (body[key] == null || body[key] === "") continue;
      const value = calendarText(body[key], key, 100, true);
      const found = key === "noteId" ? this.references?.notes.getNote(value)
        : key === "spaceId" ? this.references?.notes.getSpace(value) : this.references?.board.get(value);
      if (!found) throw new ValidationError(`Linked ${key === "noteId" ? "note" : key === "spaceId" ? "Space" : "task"} no longer exists. Clear or change that link before saving.`);
    }
    return this.store.saveEvent(body, id);
  }
  async event(id: string) {
    return id.startsWith("google-") ? (await this.google.event(id)).event : this.store.event(id);
  }
  async deleteEvent(id: string, expectedVersion: unknown) {
    if (id.startsWith("google-")) return this.google.deleteEvent(id, expectedVersion);
    return this.store.deleteEvent(id, expectedVersion);
  }
  async create(input: unknown) {
    const body = object(input);
    let url: string | undefined;
    if (body.kind === "ics") {
      if (!this.vault?.status().writable) throw new ValidationError("Enable encrypted connection storage before adding private calendar feeds");
      url = calendarText(body.url, "Feed URL", 4096, true);
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new ValidationError("Feed URL is invalid"); }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) throw new ValidationError("Feed URL must use HTTPS without embedded credentials or a fragment");
      try { await assertPublicUrl(url); } catch { throw new ValidationError("Calendar feed must resolve to a public HTTPS address"); }
    }
    const calendar = await this.store.create(body);
    if (url) {
      try { await this.vault!.setSecret(`calendar/${calendar.id}`, url); }
      catch (error) {
        await this.store.remove(calendar.id, calendar.version);
        throw error;
      }
    }
    return calendar;
  }
  async remove(id: string, expectedVersion: unknown) {
    const calendar = this.store.get(id);
    await this.store.remove(id, expectedVersion);
    // Metadata deletion is authoritative; an unreferenced encrypted credential
    // can never be used even if cleanup fails.
    if (calendar?.kind === "ics" && this.vault?.secret(`calendar/${id}`)) await this.vault.setSecret(`calendar/${id}`, null);
  }
  async snapshot(options: CalendarRange = {}): Promise<CalendarSnapshot> {
    const now = new Date();
    const rangeStart = options.rangeStart ?? now;
    const rangeEnd = options.rangeEnd ?? new Date(now.getTime() + (options.horizonDays ?? 14) * 86_400_000);
    const limit = options.limit ?? 12;
    const legacy = await fetchCalendarEvents(this.cfg.icsUrls, this.cfg.tz, {
      rangeStart, rangeEnd, limit: 10_000, localFiles: this.cfg.icsLocalFiles,
    });
    // URLs (including capability tokens) and filesystem paths never leave the service.
    const feeds = legacy.feeds.map(({ url, error, ...feed }) => ({
      ...feed, url: "", error: feed.ok ? undefined : "Calendar subscription could not be loaded.",
    }));
    const events: CalendarEvent[] = legacy.events.map((event) => ({ ...event, readOnly: true }));
    let googleTruncated = false;
    const nativeEvents = this.store.occurrences(rangeStart, rangeEnd);
    for (const calendar of this.store.list()) {
      if (!calendar.enabled) continue;
      if (calendar.kind === "native") {
        const native = nativeEvents.filter((event) => event.calendarId === calendar.id);
        events.push(...native);
        feeds.push({ url: "", id: calendar.id, name: calendar.name, ok: true, eventCount: native.length, error: undefined });
        continue;
      }
      const url = this.vault?.secret(`calendar/${calendar.id}`);
      if (!url) {
        feeds.push({ url: "", id: calendar.id, name: calendar.name, ok: false, eventCount: 0, error: "Feed credential is missing. Remove and reconnect this subscription in Settings." });
        continue;
      }
      const snapshot = await fetchCalendarEvents([url], this.cfg.tz, { rangeStart, rangeEnd, limit: 10_000 });
      events.push(...snapshot.events.map((event) => ({ ...event, calendarId: calendar.id, readOnly: true })));
      feeds.push({
        url: "", id: calendar.id, name: calendar.name, ok: snapshot.feeds[0]?.ok ?? false,
        eventCount: snapshot.events.length, error: snapshot.feeds[0]?.ok ? undefined : "Feed could not be loaded. Check its URL and access in Settings.",
      });
    }
    if (this.google.status().connected && this.google.status().selectedCalendars.length) {
      try {
        const snapshot = await this.snapshotGoogle({ rangeStart, rangeEnd, limit: 10_000 });
        events.push(...snapshot.events);
        googleTruncated = snapshot.truncated;
        feeds.push(...snapshot.calendars.map((calendar) => ({
          url: "", id: calendar.id, name: calendar.name, ok: true,
          eventCount: snapshot.events.filter((event) => event.calendarId === calendar.id).length,
          error: undefined, readOnly: !calendar.writable,
        })));
      } catch {
        feeds.push(...this.google.status().selectedCalendars.map((calendar) => ({
          url: "", id: calendar.id, name: calendar.name, ok: false, eventCount: 0,
          error: "Google Calendar could not be synchronized. Reconnect the account or check access in Settings.",
          readOnly: !calendar.writable,
        })));
      }
    }
    const ordered = events.sort((a, b) => a.start.getTime() - b.start.getTime());
    return {
      configured: this.store.list().some((calendar) => calendar.enabled) || legacy.configured || this.google.status().selectedCalendars.length > 0,
      timezone: this.cfg.tz,
      feeds: feeds.map((feed) => ({
        ...feed,
        color: this.store.get(feed.id ?? "")?.color,
        readOnly: feed.readOnly ?? this.store.get(feed.id ?? "")?.kind !== "native",
      })),
      events: ordered.slice(0, limit), truncated: legacy.truncated || googleTruncated || ordered.length > limit,
    };
  }
  async importIcs(calendarId: string, text: string) {
    if (text.length > 1_000_000) throw new ValidationError("ICS import exceeds 1 MB");
    const calendar = this.store.get(calendarId);
    if (calendar?.kind !== "native") throw new ValidationError("Import into a native calendar");
    if (!/^BEGIN:VCALENDAR\r?$/m.test(text)) throw new ValidationError("Choose a valid iCalendar file");
    if (/^(RRULE|RDATE|EXDATE|RECURRENCE-ID)(;|:)/im.test(text)) throw new ValidationError("Recurring ICS imports are not supported yet. Subscribe to the feed to keep the original series.");
    if (/^(DURATION|STATUS:CANCELLED)(;|:|$)/im.test(text)) throw new ValidationError("Imports require explicit start/end dates and cannot include cancelled events.");
    const eventCount = (text.match(/^BEGIN:VEVENT\r?$/gm) ?? []).length;
    let parsed: CalendarEvent[];
    try { parsed = parseIcsEvents(text, this.cfg.tz, new Date("1900-01-01T00:00:00Z"), true); }
    catch { throw new ValidationError("ICS contains invalid dates, timezone values, or end times. Correct the file before importing; nothing was saved."); }
    if (!eventCount || parsed.length !== eventCount || eventCount > 100) throw new ValidationError("Import up to 100 valid non-recurring events; invalid events are not silently skipped");
    // Validate the complete import before making any persistent change.
    return this.store.importEvents(calendarId, parsed.map((event) => ({
      summary: event.summary, start: event.allDay ? event.start.toISOString().slice(0, 10) : event.start.toISOString(),
      end: event.allDay ? event.end!.toISOString().slice(0, 10) : event.end!.toISOString(),
      allDay: event.allDay, timezone: this.cfg.tz, description: event.description ?? "", location: event.location ?? "",
    })));
  }
}
