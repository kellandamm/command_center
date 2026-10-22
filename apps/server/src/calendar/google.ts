import { createHash, randomBytes } from "node:crypto";
import type { Config } from "../config";
import type { ConnectionsStore } from "../connections";
import { ValidationError } from "../settings";
import { CalendarConflictError, calendarLocalInstant, calendarText, type CalendarRange, validDay, zonedParts } from "./store";
import type { CalendarEvent } from "./parse-ics";

interface GoogleCalendar {
  id: string;
  summary: string;
  timeZone?: string;
  accessRole?: string;
  deleted?: boolean;
}

interface GoogleEvent {
  id: string;
  etag: string;
  status?: string;
  recurringEventId?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  htmlLink?: string;
}

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface PendingAuthorization {
  verifier: string;
  expiresAt: number;
}

export interface SelectedGoogleCalendar {
  id: string;
  googleId: string;
  name: string;
  timezone: string;
  writable: boolean;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const API_URL = "https://www.googleapis.com/calendar/v3";
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");
const idForCalendar = (id: string) => `google-${Buffer.from(id).toString("base64url")}`;
const idForEvent = (calendarId: string, eventId: string) =>
  `google-${Buffer.from(`${calendarId}\0${eventId}`).toString("base64url")}`;

function safeJson<T>(text: string): T {
  try { return JSON.parse(text) as T; }
  catch { throw new Error("Google returned an invalid response."); }
}

function eventTime(value: { date?: string; dateTime?: string } | undefined): Date | undefined {
  if (value?.date && validDay(value.date)) return new Date(`${value.date}T00:00:00Z`);
  if (value?.dateTime) {
    const parsed = new Date(value.dateTime);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return undefined;
}

function normalizedCalendar(calendar: GoogleCalendar, timezone: string): SelectedGoogleCalendar {
  return {
    id: idForCalendar(calendar.id), googleId: calendar.id,
    name: calendar.summary || calendar.id, timezone: calendar.timeZone || timezone,
    writable: calendar.accessRole === "writer" || calendar.accessRole === "owner",
  };
}

export class GoogleCalendarConnector {
  private pending = new Map<string, PendingAuthorization>();
  private selected: SelectedGoogleCalendar[] = [];
  private tokenCache?: OAuthTokens;

  constructor(
    private cfg: Config,
    private vault?: ConnectionsStore,
    private request: typeof fetch = fetch,
  ) {
    const raw = vault?.secret("google/selected-calendars");
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length > 50 || !parsed.every((item) =>
          item && typeof item.id === "string" && /^google-[A-Za-z0-9_-]+$/.test(item.id)
          && typeof item.googleId === "string" && item.googleId.length > 0 && item.googleId.length <= 512
          && item.id === idForCalendar(item.googleId)
          && typeof item.name === "string" && item.name.length <= 1024
          && typeof item.timezone === "string" && item.timezone.length <= 100
          && typeof item.writable === "boolean")) throw new Error("selection");
        if (new Set(parsed.map((item) => (item as SelectedGoogleCalendar).googleId)).size !== parsed.length) throw new Error("duplicate");
        this.selected = parsed as SelectedGoogleCalendar[];
      } catch {
        throw new Error("Saved Google Calendar selection is invalid; disconnect and reconnect Google Calendar.");
      }
    }
  }

  status() {
    return {
      configured: !!(this.cfg.googleClientId && this.cfg.googleClientSecret && this.cfg.googleRedirectUri),
      connected: !!this.vault?.secret("google/oauth"),
      credentialsWritable: this.vault?.status().writable ?? false,
      selectedCalendars: this.selected.map(({ googleId: _googleId, ...calendar }) => ({ ...calendar })),
    };
  }

  beginAuthorization(): { url: string; state: string } {
    if (!this.cfg.googleClientId || !this.cfg.googleClientSecret || !this.cfg.googleRedirectUri) {
      throw new ValidationError("Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI before connecting Google Calendar.");
    }
    if (!this.vault?.status().writable) throw new ValidationError("Set CONNECTIONS_MASTER_KEY to enable encrypted Google token storage.");
    const now = Date.now();
    for (const [state, pending] of this.pending) if (pending.expiresAt <= now) this.pending.delete(state);
    while (this.pending.size >= 100) this.pending.delete(this.pending.keys().next().value!);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    this.pending.set(state, { verifier, expiresAt: now + 10 * 60_000 });
    const url = new URL(AUTH_URL);
    url.searchParams.set("client_id", this.cfg.googleClientId);
    url.searchParams.set("redirect_uri", this.cfg.googleRedirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_SCOPES);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    url.searchParams.set("code_challenge_method", "S256");
    return { url: url.href, state };
  }

  async finishAuthorization(state: string, code: string): Promise<void> {
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || pending.expiresAt <= Date.now()) throw new ValidationError("Google sign-in expired or could not be verified. Start again from Calendar settings.");
    const response = await this.request(TOKEN_URL, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: this.cfg.googleClientId!, client_secret: this.cfg.googleClientSecret!,
        redirect_uri: this.cfg.googleRedirectUri!, grant_type: "authorization_code", code_verifier: pending.verifier,
      }),
    });
    const body = safeJson<{ access_token?: string; refresh_token?: string; expires_in?: number }>(await this.responseText(response));
    const previous = this.readTokens();
    if (!response.ok || !body.access_token) throw new Error("Google sign-in failed. Check the OAuth client configuration and redirect URI.");
    const tokens: OAuthTokens = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? previous?.refreshToken ?? "",
      expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000,
    };
    if (!tokens.refreshToken) throw new Error("Google did not return a refresh token. Revoke this app in Google Account permissions, then connect again.");
    await this.saveTokens(tokens);
    this.tokenCache = tokens;
  }

  async disconnect(): Promise<void> {
    const tokens = this.readTokens();
    if (tokens) {
      let response: Response;
      try {
        response = await this.request("https://oauth2.googleapis.com/revoke", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: tokens.refreshToken }),
        });
      } catch {
        throw new ValidationError("Google access could not be revoked. The local connection was kept; retry disconnect or revoke it in your Google Account.");
      }
      if (!response.ok) throw new ValidationError("Google access could not be revoked. The local connection was kept; retry disconnect or revoke it in your Google Account.");
    }
    this.pending.clear();
    this.tokenCache = undefined;
    this.selected = [];
    if (this.vault?.secret("google/oauth")) await this.vault.setSecret("google/oauth", null);
    if (this.vault?.secret("google/selected-calendars")) await this.vault.setSecret("google/selected-calendars", null);
  }

  async listCalendars(): Promise<SelectedGoogleCalendar[]> {
    const rows: GoogleCalendar[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${API_URL}/users/me/calendarList`);
      url.searchParams.set("maxResults", "250");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const result = await this.api<{ items?: GoogleCalendar[]; nextPageToken?: string }>(url);
      rows.push(...(result.items ?? []));
      pageToken = result.nextPageToken;
      if (rows.length > 1000) throw new Error("Google returned too many calendars.");
    } while (pageToken);
    return rows.filter((row) => !row.deleted).map((row) => normalizedCalendar(row, this.cfg.tz));
  }

  async selectCalendars(ids: unknown): Promise<Omit<SelectedGoogleCalendar, "googleId">[]> {
    if (!Array.isArray(ids) || ids.length > 50 || ids.some((id) => typeof id !== "string" || id.length > 512)) {
      throw new ValidationError("Select up to 50 Google calendars.");
    }
    const all = await this.listCalendars();
    const selected = new Set(ids as string[]);
    const calendars = all.filter((calendar) => selected.has(calendar.id));
    if (calendars.length !== selected.size) throw new ValidationError("A selected Google calendar is no longer available. Reload the list and try again.");
    await this.vault!.setSecret("google/selected-calendars", JSON.stringify(calendars));
    this.selected = calendars;
    return this.status().selectedCalendars;
  }

  async snapshot(range: CalendarRange): Promise<{ calendars: Omit<SelectedGoogleCalendar, "googleId">[]; events: CalendarEvent[]; truncated: boolean }> {
    const rangeStart = range.rangeStart ?? new Date();
    const rangeEnd = range.rangeEnd ?? new Date(rangeStart.getTime() + (range.horizonDays ?? 14) * 86_400_000);
    const events: CalendarEvent[] = [];
    const eventLimit = Math.min(10_000, Math.max(1, range.limit ?? 12));
    let truncated = false;
    for (const calendar of this.selected) {
      if (events.length >= eventLimit) { truncated = true; break; }
      const url = new URL(`${API_URL}/calendars/${encodeURIComponent(calendar.googleId)}/events`);
      url.searchParams.set("timeMin", rangeStart.toISOString());
      url.searchParams.set("timeMax", rangeEnd.toISOString());
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("maxResults", String(Math.min(2500, eventLimit)));
      let pageToken: string | undefined;
      let count = 0;
      do {
        const remaining = eventLimit - events.length;
        if (remaining <= 0) { truncated = true; break; }
        url.searchParams.set("maxResults", String(Math.min(2500, remaining)));
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const result = await this.api<{ items?: GoogleEvent[]; nextPageToken?: string }>(url);
        for (const event of result.items ?? []) {
          if (events.length >= eventLimit) { truncated = true; break; }
          const normalized = this.normalizeEvent(calendar, event);
          if (normalized) events.push(normalized);
        }
        pageToken = result.nextPageToken;
        if (events.length >= eventLimit && (pageToken || this.selected.indexOf(calendar) < this.selected.length - 1)) {
          truncated = true;
          break;
        }
        if (++count > 10) throw new Error("Google Calendar sync exceeded the page limit.");
      } while (pageToken);
      if (truncated) break;
    }
    return { calendars: this.selected.map(({ googleId: _id, ...calendar }) => calendar), events, truncated };
  }

  async event(id: string) {
    const target = this.decodeEventId(id);
    const calendar = this.selected.find((item) => item.googleId === target.calendarId);
    if (!calendar) throw new ValidationError("Google Calendar event is no longer selected.");
    const event = await this.api<GoogleEvent>(`${API_URL}/calendars/${encodeURIComponent(target.calendarId)}/events/${encodeURIComponent(target.eventId)}`);
    const normalized = this.normalizeEvent(calendar, event);
    if (!normalized) throw new ValidationError("Google Calendar event is cancelled or has invalid dates.");
    return { event: this.editableEvent(calendar, event, normalized) };
  }

  async saveEvent(input: Record<string, unknown>, id?: string) {
    const calendar = this.selected.find((item) => item.id === input.calendarId);
    if (!calendar?.writable) throw new ValidationError("Choose a writable Google calendar.");
    const remote = id ? this.decodeEventId(id) : undefined;
    if (remote && remote.calendarId !== calendar.googleId) throw new ValidationError("Moving events between calendars is not supported.");
    if (id && (typeof input.expectedSyncVersion !== "string" || !input.expectedSyncVersion || input.expectedSyncVersion.length > 256
      || /[\r\n\0]/.test(input.expectedSyncVersion))) {
      throw new ValidationError("Refresh the event before editing it.");
    }
    let current: GoogleEvent | undefined;
    if (remote) {
      current = await this.api<GoogleEvent>(`${API_URL}/calendars/${encodeURIComponent(remote.calendarId)}/events/${encodeURIComponent(remote.eventId)}`);
      if (current.recurringEventId) throw new ValidationError("Google Calendar recurring events are not supported by this editor yet.");
      if (!current.etag) throw new ValidationError("Google did not provide an event version, so this event cannot be edited safely.");
    }
    const summary = calendarText(input.summary, "Event title", 240, true);
    const location = calendarText(input.location ?? "", "Location", 2000);
    const description = calendarText(input.description ?? "", "Description", 20_000);
    if (typeof input.allDay !== "boolean") throw new ValidationError("allDay must be boolean.");
    const timezone = calendarText(input.timezone, "Timezone", 100, true);
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); }
    catch { throw new ValidationError("Timezone must be a valid IANA zone."); }
    const resource: Record<string, unknown> = {
      summary, location, description,
    };
    if (input.allDay === true) {
      const start = calendarText(input.start, "Start", 10, true);
      const end = calendarText(input.end, "End", 10, true);
      if (!validDay(start) || !validDay(end) || Date.parse(end) <= Date.parse(start)
        || Date.parse(end) - Date.parse(start) > 366 * 86_400_000) {
        throw new ValidationError("Use valid date-only values, with the end after the start.");
      }
      resource.start = { date: start };
      resource.end = { date: end };
    } else {
      const localInstant = (value: unknown) => {
        if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) throw new ValidationError("Enter a valid local date and time.");
        const instant = calendarLocalInstant(value.slice(0, 10), value.slice(11), timezone);
        if (!instant) {
          throw new ValidationError("That local time does not exist because of a timezone clock change. Choose another time.");
        }
        return instant.toISOString();
      };
      const start = input.localStart === undefined ? input.start : localInstant(input.localStart);
      const end = input.localEnd === undefined ? input.end : localInstant(input.localEnd);
      const startInstant = new Date(String(start)), endInstant = new Date(String(end));
      if (!Number.isFinite(startInstant.getTime()) || !Number.isFinite(endInstant.getTime()) || endInstant <= startInstant
        || endInstant.getTime() - startInstant.getTime() > 366 * 86_400_000) {
        throw new ValidationError("Event end must follow its start.");
      }
      const unchanged = (value: unknown, original: GoogleEvent["start"]) => {
        if (!remote || typeof value !== "string" || !original?.dateTime) return false;
        const originalTimezone = original.timeZone ?? calendar.timezone;
        const originalParts = zonedParts(new Date(original.dateTime).toISOString(), timezone);
        return originalTimezone === timezone && `${originalParts.day}T${originalParts.time}` === value;
      };
      if (!unchanged(input.localStart, current?.start)) resource.start = { dateTime: startInstant.toISOString(), timeZone: timezone };
      if (!unchanged(input.localEnd, current?.end)) resource.end = { dateTime: endInstant.toISOString(), timeZone: timezone };
    }
    const url = remote
      ? `${API_URL}/calendars/${encodeURIComponent(remote.calendarId)}/events/${encodeURIComponent(remote.eventId)}`
      : `${API_URL}/calendars/${encodeURIComponent(calendar.googleId)}/events`;
    const response = await this.apiResponse(url, {
      method: remote ? "PATCH" : "POST",
      headers: remote ? { "If-Match": String(input.expectedSyncVersion) } : {},
      body: JSON.stringify(resource),
    });
    if (response.status === 412) throw new CalendarConflictError("This Google Calendar event changed elsewhere. Refresh before editing; your changes have not been applied.");
    if (!response.ok) throw new Error("Google Calendar could not save the event. Check the calendar permissions and try again.");
    const saved = safeJson<GoogleEvent>(await this.responseText(response));
    const normalized = this.normalizeEvent(calendar, saved);
    if (!normalized) throw new Error("Google saved the event but returned invalid event dates.");
    return { event: this.editableEvent(calendar, saved, normalized) };
  }

  async deleteEvent(id: string, expectedVersion: unknown): Promise<void> {
    if (typeof expectedVersion !== "string" || !expectedVersion || expectedVersion.length > 256 || /[\r\n\0]/.test(expectedVersion)) {
      throw new ValidationError("Refresh the event before deleting it.");
    }
    const target = this.decodeEventId(id);
    if (!this.selected.some((calendar) => calendar.googleId === target.calendarId && calendar.writable)) {
      throw new ValidationError("The selected Google calendar is not writable.");
    }
    const current = await this.api<GoogleEvent>(`${API_URL}/calendars/${encodeURIComponent(target.calendarId)}/events/${encodeURIComponent(target.eventId)}`);
    if (current.recurringEventId) throw new ValidationError("Google Calendar recurring events are not supported by this editor yet.");
    if (!current.etag) throw new ValidationError("Google did not provide an event version, so this event cannot be edited safely.");
    const response = await this.apiResponse(
      `${API_URL}/calendars/${encodeURIComponent(target.calendarId)}/events/${encodeURIComponent(target.eventId)}`,
      { method: "DELETE", headers: { "If-Match": expectedVersion } },
    );
    if (response.status === 412) throw new CalendarConflictError("This Google Calendar event changed elsewhere. Refresh before deleting; nothing was deleted.");
    if (!response.ok) throw new Error("Google Calendar could not delete the event. Check the calendar permissions and try again.");
  }

  private decodeEventId(id: string): { calendarId: string; eventId: string } {
    if (!id.startsWith("google-")) throw new ValidationError("Invalid Google Calendar event.");
    try {
      const decoded = Buffer.from(id.slice(7), "base64url").toString("utf8").split("\0");
      if (decoded.length !== 2 || !decoded[0] || !decoded[1]) throw new Error("id");
      return { calendarId: decoded[0], eventId: decoded[1] };
    } catch { throw new ValidationError("Invalid Google Calendar event."); }
  }

  private normalizeEvent(calendar: SelectedGoogleCalendar, event: GoogleEvent): CalendarEvent | undefined {
    if (event.status === "cancelled" || !event.id) return undefined;
    const start = eventTime(event.start), end = eventTime(event.end);
    if (!start || !end || end <= start) return undefined;
    const allDay = !!event.start?.date;
    return {
      uid: event.id, eventId: idForEvent(calendar.googleId, event.id), calendarId: calendar.id,
      summary: event.summary || "(Untitled event)", start, end, allDay,
      location: event.location ?? null, description: event.description ?? null, url: event.htmlLink ?? null,
      readOnly: !calendar.writable || !!event.recurringEventId || !event.etag, recurrence: "none", syncVersion: event.etag,
    };
  }

  private editableEvent(calendar: SelectedGoogleCalendar, event: GoogleEvent, normalized: CalendarEvent) {
    return {
      id: normalized.eventId, calendarId: calendar.id, summary: normalized.summary,
      start: normalized.allDay ? event.start!.date! : normalized.start.toISOString(),
      end: normalized.allDay ? event.end!.date! : normalized.end!.toISOString(),
      allDay: normalized.allDay, timezone: event.start?.timeZone ?? calendar.timezone,
      location: normalized.location ?? "", description: normalized.description ?? "",
      spaceId: null, noteId: null, taskId: null, recurrence: "none", repeatUntil: null,
      version: 1, expectedSyncVersion: event.etag, syncVersion: event.etag,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
  }

  private readTokens(): OAuthTokens | undefined {
    if (this.tokenCache) return this.tokenCache;
    const raw = this.vault?.secret("google/oauth");
    if (!raw) return undefined;
    try {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === "object" && typeof (value as OAuthTokens).accessToken === "string"
        && typeof (value as OAuthTokens).refreshToken === "string" && typeof (value as OAuthTokens).expiresAt === "number") {
        this.tokenCache = value as OAuthTokens;
        return this.tokenCache;
      }
    } catch { /* invalid vault records are rejected below */ }
    throw new Error("Saved Google authorization is invalid. Disconnect and reconnect Google Calendar.");
  }

  private async saveTokens(tokens: OAuthTokens) {
    if (!this.vault?.status().writable) throw new Error("Encrypted Google token storage is unavailable.");
    await this.vault.setSecret("google/oauth", JSON.stringify(tokens));
  }

  private async accessToken(): Promise<string> {
    const tokens = this.readTokens();
    if (!tokens) throw new ValidationError("Connect Google Calendar in Calendar settings.");
    if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
    const response = await this.request(TOKEN_URL, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.cfg.googleClientId!, client_secret: this.cfg.googleClientSecret!,
        refresh_token: tokens.refreshToken, grant_type: "refresh_token",
      }),
    });
    const body = safeJson<{ access_token?: string; expires_in?: number }>(await this.responseText(response));
    if (!response.ok || !body.access_token) {
      this.tokenCache = undefined;
      throw new Error("Google authorization expired or was revoked. Reconnect Google Calendar in Settings.");
    }
    const refreshed = { ...tokens, accessToken: body.access_token, expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000 };
    await this.saveTokens(refreshed);
    this.tokenCache = refreshed;
    return refreshed.accessToken;
  }

  private async api<T>(url: string | URL): Promise<T> {
    const response = await this.apiResponse(url);
    if (!response.ok) throw new Error("Google Calendar could not be reached. Reconnect the account or check calendar access.");
    return safeJson<T>(await this.responseText(response));
  }

  private async apiResponse(url: string | URL, init: RequestInit = {}): Promise<Response> {
    const token = await this.accessToken();
    return this.request(url, {
      ...init, redirect: "error", signal: init.signal ?? AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    });
  }

  private async responseText(response: Response): Promise<string> {
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1_000_000) {
          await reader.cancel();
          throw new Error("Google Calendar response exceeded the size limit.");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  }
}
