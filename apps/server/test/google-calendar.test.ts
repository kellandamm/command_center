import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { ConnectionsStore } from "../src/connections";
import { GoogleCalendarConnector } from "../src/calendar/google";

const remoteEvent = {
  id: "event-1", etag: '"etag-1"', summary: "Planning", location: "Studio", description: "Agenda",
  start: { dateTime: "2030-01-01T15:00:00Z", timeZone: "UTC" },
  end: { dateTime: "2030-01-01T16:00:00Z", timeZone: "UTC" },
};

test("Google OAuth stores tokens encrypted, selects calendars, syncs events, and uses ETags for edits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "google-calendar-"));
  try {
    const cfg = loadConfig({
      DATA_DIR: dir, CONNECTIONS_MASTER_KEY: "a".repeat(64),
      GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_REDIRECT_URI: "https://calendar.example/api/google-calendar/callback",
    });
    const vault = await ConnectionsStore.open(cfg);
    let currentEvent = { ...remoteEvent };
    let patchPrecondition = "";
    let patchBody: Record<string, unknown> = {};
    const request: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 }), { status: 200 });
      }
      if (url === "https://oauth2.googleapis.com/revoke") return new Response("", { status: 200 });
      if (url.includes("/users/me/calendarList")) {
        return new Response(JSON.stringify({ items: [{ id: "work@example.com", summary: "Work", timeZone: "UTC", accessRole: "writer" }] }), { status: 200 });
      }
      if (url.includes("/events?")) return new Response(JSON.stringify({
        items: [currentEvent], ...(url.includes("maxResults=1") ? { nextPageToken: "more-events" } : {}),
      }), { status: 200 });
      if (url.includes("/events/event-1") && (!init?.method || init.method === "GET")) return new Response(JSON.stringify(currentEvent), { status: 200 });
      if (url.includes("/events/event-1") && init?.method === "PATCH") {
        patchPrecondition = new Headers(init.headers).get("If-Match") ?? "";
        if (patchPrecondition !== currentEvent.etag) return new Response("", { status: 412 });
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        currentEvent = { ...currentEvent, ...patchBody, etag: '"etag-2"' };
        return new Response(JSON.stringify(currentEvent), { status: 200 });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    };
    const google = new GoogleCalendarConnector(cfg, vault, request);
    const authorization = google.beginAuthorization();
    const authUrl = new URL(authorization.url);
    assert.equal(authUrl.searchParams.get("state"), authorization.state);
    assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
    assert.notEqual(authUrl.searchParams.get("code_challenge"), null);
    assert.equal(authUrl.searchParams.has("code_verifier"), false);
    await google.finishAuthorization(authorization.state, "one-time-code");
    const calendars = await google.listCalendars();
    assert.equal(calendars.length, 1);
    const selected = await google.selectCalendars([calendars[0]!.id]);
    assert.equal(selected[0]!.name, "Work");
    await assert.rejects(google.saveEvent({
      calendarId: selected[0]!.id, summary: "DST gap", timezone: "America/Chicago", allDay: false,
      localStart: "2030-03-10T02:30", localEnd: "2030-03-10T03:30",
    }), /does not exist/);
    const snapshot = await google.snapshot({ rangeStart: new Date("2030-01-01T00:00:00Z"), rangeEnd: new Date("2030-01-02T00:00:00Z") });
    assert.equal(snapshot.events[0]!.summary, "Planning");
    assert.equal(snapshot.events[0]!.readOnly, false);
    const capped = await google.snapshot({
      rangeStart: new Date("2030-01-01T00:00:00Z"),
      rangeEnd: new Date("2030-01-02T00:00:00Z"), limit: 1,
    });
    assert.equal(capped.events.length, 1);
    assert.equal(capped.truncated, true);
    const remoteId = snapshot.events[0]!.eventId!;
    const editable = await google.event(remoteId);
    const changed = await google.saveEvent({
      calendarId: selected[0]!.id, summary: "Updated", timezone: "UTC", allDay: false,
      localStart: "2030-01-01T15:00", localEnd: "2030-01-01T16:00",
      expectedSyncVersion: editable.event.syncVersion,
    }, remoteId);
    assert.equal(changed.event.summary, "Updated");
    assert.equal(patchPrecondition, '"etag-1"');
    assert.deepEqual(Object.keys(patchBody).sort(), ["description", "location", "summary"]);
    assert.equal((await readFile(join(dir, "connections.enc.json"), "utf8")).includes("refresh-token"), false);
    await google.disconnect();
    assert.equal(google.status().connected, false);
    assert.equal(vault.secret("google/selected-calendars"), undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Google Calendar rejects stale ETags and invalid OAuth state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "google-calendar-"));
  try {
    const cfg = loadConfig({
      DATA_DIR: dir, CONNECTIONS_MASTER_KEY: "b".repeat(64),
      GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_REDIRECT_URI: "https://calendar.example/api/google-calendar/callback",
    });
    const vault = await ConnectionsStore.open(cfg);
    const request: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("/users/me/calendarList")) {
        return new Response(JSON.stringify({ items: [{ id: "work@example.com", summary: "Work", timeZone: "UTC", accessRole: "writer" }] }), { status: 200 });
      }
      if (url.includes("/events/event-1") && (!init?.method || init.method === "GET")) return new Response(JSON.stringify(remoteEvent), { status: 200 });
      if (url.includes("/events/event-1") && init?.method === "PATCH") return new Response("", { status: 412 });
      throw new Error(`Unexpected Google request: ${url}`);
    };
    const google = new GoogleCalendarConnector(cfg, vault, request);
    const authorization = google.beginAuthorization();
    await assert.rejects(google.finishAuthorization("wrong-state", "code"), /could not be verified/);
    await google.finishAuthorization(authorization.state, "code");
    const [calendar] = await google.listCalendars();
    const [selected] = await google.selectCalendars([calendar!.id]);
    const eventId = `google-${Buffer.from("work@example.com\0event-1").toString("base64url")}`;
    await assert.rejects(google.saveEvent({
      calendarId: selected!.id, summary: "Overwrite", timezone: "UTC", allDay: false,
      localStart: "2030-01-01T15:00", localEnd: "2030-01-01T16:00", expectedSyncVersion: '"stale"',
    }, eventId), /changed elsewhere/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
