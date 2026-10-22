import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { CalendarStore } from "../src/calendar/store";
import { CalendarWorkspace } from "../src/calendar/workspace";
import { exportCalendar } from "../src/calendar/export";
import { ConnectionsStore } from "../src/connections";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { createApp } from "../src/http";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const draft = {
  summary: "Planning", allDay: false, timezone: "America/Chicago",
  start: "2030-03-08T15:00:00Z", end: "2030-03-08T16:00:00Z",
  location: "Studio", description: "Review notes", recurrence: "none",
};
const between = (store: CalendarStore, from = "2030-01-01", to = "2031-01-01") => store.occurrences(new Date(from), new Date(to));
const ics = (events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.map((event) => `BEGIN:VEVENT\n${event}\nEND:VEVENT`), "END:VCALENDAR"].join("\n");
const icsEvent = "SUMMARY:Imported\\, planning\nDTSTART:20300610T140000Z\nDTEND:20300610T150000Z";

test("managed calendars persist, serialize conditional edits, and reject damaged records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-calendar-"));
  try {
    let store = await CalendarStore.open(dir);
    const calendar = await store.create({ kind: "native", name: "Work", color: "#123456" });
    const event = await store.saveEvent({ ...draft, calendarId: calendar.id });
    const outcomes = await Promise.allSettled([
      store.saveEvent({ ...event, summary: "First edit", expectedVersion: event.version }, event.id),
      store.saveEvent({ ...event, summary: "Stale edit", expectedVersion: event.version }, event.id),
    ]);
    assert.deepEqual(outcomes.map((outcome) => outcome.status), ["fulfilled", "rejected"]);
    await assert.rejects(store.deleteEvent(event.id, event.version), /changed elsewhere/);
    store = await CalendarStore.open(dir);
    assert.equal(store.event(event.id)?.summary, "First edit");
    assert.equal(store.event(event.id)?.version, 2);
    for (const body of [
      { start: "2030-03-08T24:00:00Z" }, { start: "2030-02-30T15:00:00Z" },
      { start: "2030-03-08T15:60:00Z" }, { recurrence: "yearly" },
      { recurrence: "weekly", repeatUntil: null },
      { recurrence: "daily", repeatUntil: "2032-01-01" },
    ]) await assert.rejects(store.saveEvent({ ...draft, calendarId: calendar.id, ...body }));
    const subscription = await store.create({ kind: "ics", name: "Read only" });
    await assert.rejects(store.saveEvent({ ...draft, calendarId: subscription.id }), /read-only/);
    const saved = JSON.parse(await readFile(join(dir, "calendars.json"), "utf8"));
    saved.calendars[0].feedKeyHash = "bad-hash";
    await writeFile(join(dir, "calendars.json"), JSON.stringify(saved));
    await assert.rejects(CalendarStore.open(dir), /Invalid calendars.json/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("native recurrence preserves wall time across DST, skips gaps/monthly overflow, and exports paused series", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-calendar-"));
  try {
    const store = await CalendarStore.open(dir);
    const calendar = await store.create({ kind: "native", name: "Focus" });
    await store.saveEvent({ ...draft, calendarId: calendar.id, recurrence: "daily", repeatUntil: "2030-03-12" });
    const events = between(store, "2030-03-08", "2030-03-13");
    assert.equal(events.length, 5);
    assert.equal(events[0]!.start.toISOString(), "2030-03-08T15:00:00.000Z");
    assert.equal(events[2]!.start.toISOString(), "2030-03-10T14:00:00.000Z");
    const gap = await store.saveEvent({
      ...draft, calendarId: calendar.id, localStart: "2030-03-09T02:30", localEnd: "2030-03-09T03:30",
      recurrence: "daily", repeatUntil: "2030-03-11",
    });
    assert.equal(between(store).filter((event) => event.eventId === gap.id).length, 2);
    await assert.rejects(store.saveEvent({
      ...draft, calendarId: calendar.id, localStart: "2030-03-10T02:30", localEnd: "2030-03-10T04:00",
    }), /does not exist/);
    const monthly = await store.saveEvent({
      ...draft, calendarId: calendar.id, allDay: true, start: "2030-01-31", end: "2030-02-02",
      recurrence: "monthly", repeatUntil: "2030-05-31",
    });
    assert.deepEqual(between(store).filter((event) => event.eventId === monthly.id).map((event) => event.start.toISOString().slice(0, 10)), ["2030-01-31", "2030-03-31", "2030-05-31"]);
    const key = await store.publish(calendar.id, calendar.version);
    assert.equal(store.published(calendar.id, key), true);
    assert.equal(JSON.stringify(store.list()).includes("feedKeyHash"), false);
    await store.update(calendar.id, { expectedVersion: 2, enabled: false });
    assert.equal(between(store).length, 0);
    assert.equal(store.published(calendar.id, key), false);
    const output = exportCalendar(store, calendar.id);
    assert.equal((output.match(/BEGIN:VEVENT/g) ?? []).length, 10);
    assert.match(output, /DTSTART;VALUE=DATE:20300531/);
    assert.doesNotMatch(output, /RRULE/);
    assert.ok(output.split("\r\n").every((line) => Buffer.byteLength(line) <= 75));
    await store.update(calendar.id, { expectedVersion: 3, enabled: true });
    const replacement = await store.publish(calendar.id, 4);
    assert.equal(store.published(calendar.id, key), false);
    assert.equal(store.published(calendar.id, replacement), true);
    const london = await store.saveEvent({
      ...draft, calendarId: calendar.id, timezone: "Europe/London", localStart: "2030-10-27T01:30", localEnd: "2030-10-27T02:30",
    });
    assert.equal(london.start, "2030-10-27T00:30:00.000Z");
    const seconds = await store.saveEvent({
      ...draft, calendarId: calendar.id, start: "2030-03-08T15:00:30.123Z", end: "2030-03-08T16:00:30.123Z",
      recurrence: "daily", repeatUntil: "2030-03-10",
    });
    assert.equal(between(store).find((event) => event.eventId === seconds.id && event.start.getUTCDate() === 10)?.start.toISOString(), "2030-03-10T14:00:30.123Z");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("ICS imports are atomic, strictly validated and deduplicated across concurrent imports", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-calendar-"));
  try {
    const cfg = loadConfig({ DATA_DIR: dir, ALLOW_INSECURE_NO_AUTH: "1", TZ: "UTC" });
    const workspace = await CalendarWorkspace.open(cfg);
    const calendar = await workspace.create({ kind: "native", name: "Imported" });
    const results = await Promise.all([
      workspace.importIcs(calendar.id, ics([icsEvent, icsEvent])),
      workspace.importIcs(calendar.id, ics([icsEvent])),
    ]);
    assert.equal(results.reduce((total, result) => total + result.imported, 0), 1);
    assert.equal(workspace.store.events().length, 1);
    const invalid = [
      "SUMMARY:Bad\nDTSTART:20300230T100000Z\nDTEND:20300230T110000Z",
      "SUMMARY:Bad\nDTSTART:20300610T150000Z\nDTEND:20300610T140000Z",
      "SUMMARY:Bad\nDTSTART:20300610T140000Z\nDURATION:PT1H",
      `${icsEvent}\nRRULE:FREQ=DAILY`, `${icsEvent}\nSTATUS:CANCELLED`,
      "SUMMARY:Bad\nDTSTART:20300610T140000Z",
      `SUMMARY:${"X".repeat(241)}\nDTSTART:20300610T150000Z\nDTEND:20300610T160000Z`,
    ];
    for (const event of invalid) {
      await assert.rejects(workspace.importIcs(calendar.id, ics([icsEvent.replace("Imported", "Fresh"), event])));
      assert.equal(workspace.store.events().length, 1);
    }
    const allDay = "SUMMARY:Holiday\nDTSTART;VALUE=DATE:20300611";
    assert.equal((await workspace.importIcs(calendar.id, ics([allDay]))).imported, 1);
    const saved = workspace.store.events().find((event) => event.allDay)!;
    assert.equal(saved.start, "2030-06-11");
    assert.equal(saved.end, "2030-06-12");
    assert.match(exportCalendar(workspace.store, calendar.id), /SUMMARY:Imported\\, planning/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("managed subscriptions encrypt private URLs and redact snapshots and diagnostics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-calendar-"));
  try {
    const cfg = loadConfig({ DATA_DIR: dir, ALLOW_INSECURE_NO_AUTH: "1", CONNECTIONS_MASTER_KEY: "a".repeat(64), TZ: "UTC", ICS_LOCAL_FILES: join(dir, "missing-private-path.ics") });
    const vault = await ConnectionsStore.open(cfg);
    const workspace = await CalendarWorkspace.open(cfg, vault);
    const entry = await workspace.store.create({ kind: "ics", name: "Private" });
    const privateUrl = "https://private.example/calendar?token=never-expose-this";
    await vault.setSecret(`calendar/${entry.id}`, privateUrl);
    assert.ok(!(await readFile(join(dir, "connections.enc.json"), "utf8")).includes(privateUrl));
    assert.ok(!(await readFile(join(dir, "calendars.json"), "utf8")).includes(privateUrl));
    const restored = await ConnectionsStore.open(cfg);
    assert.equal(restored.secret(`calendar/${entry.id}`), privateUrl);
    await workspace.store.update(entry.id, { expectedVersion: 1, enabled: false });
    const metadata = JSON.stringify(workspace.status());
    const snapshot = JSON.stringify(await workspace.snapshot());
    assert.ok(!metadata.includes(privateUrl));
    assert.ok(!snapshot.includes(dir));
    assert.ok(!snapshot.includes("missing-private-path"));
    await workspace.remove(entry.id, 2);
    assert.equal(vault.secret(`calendar/${entry.id}`), undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("calendar APIs enforce owner/CSRF boundaries, shared snapshots, version checks, and revocable native-only feeds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-calendar-api-"));
  const token = "t".repeat(32);
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: token, OWNER_EMAILS: "owner@example.com", TZ: "UTC" });
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board: integration.board });
  const settings = new SettingsStore(dir); await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const server = createApp({
    cfg, notes, ...integration, calendar, settings, dailyBriefing,
    auth: makeAuthenticator(cfg, async (jwt) => {
      if (jwt === "owner") return { email: "owner@example.com" };
      if (jwt === "ordinary") return { email: "reader@example.com" };
      if (jwt === "machine") return { email: "owner@example.com", common_name: "worker" };
      throw new Error("Invalid test JWT");
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { "cf-access-jwt-assertion": "owner", "x-ah": "1", "content-type": "application/json" };
  const request = (path: string, method = "GET", body?: unknown, customHeaders: Record<string, string> = headers) =>
    fetch(base + path, { method, headers: customHeaders, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.equal((await request("/api/calendars", "GET", undefined, {})).status, 401);
    for (const identity of ["ordinary", "machine", "admin"]) {
      const auth: Record<string, string> = identity === "admin" ? { authorization: `Bearer ${token}` } : { "cf-access-jwt-assertion": identity };
      const access = { ...auth, "x-ah": "1" };
      assert.equal((await request("/api/calendars", "GET", undefined, access)).status, 200);
      assert.equal((await request("/api/calendars", "POST", { kind: "native", name: "Denied" }, access)).status, 403);
    }
    assert.equal((await request("/api/calendars", "POST", {}, { ...headers, "x-ah": "" })).status, 403);
    assert.equal((await request("/api/calendars", "POST", {}, { ...headers, origin: "https://evil.example" })).status, 403);
    const created = await request("/api/calendars", "POST", { kind: "native", name: "Work" });
    assert.equal(created.status, 201);
    const entry = (await created.json()).calendar;
    const note = await notes.createNote({ title: "Meeting", content: "Agenda" });
    const saved = await request("/api/calendar-events", "POST", { ...draft, calendarId: entry.id, noteId: note.id });
    assert.equal(saved.status, 201);
    const event = (await saved.json()).event;
    const response = await request("/api/calendar?start=2030-03-01&end=2030-04-01");
    const snapshot = await response.json();
    assert.equal(snapshot.events[0].eventId, event.id);
    assert.equal(snapshot.events[0].readOnly, false);
    assert.equal(snapshot.events[0].url, `/notes?note=${note.id}`);
    const soon = await calendar.saveEvent({
      ...draft, calendarId: entry.id, summary: "Shared upcoming event",
      start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString(),
    });
    assert.ok((await (await request("/api/calendar")).json()).events.some((row: { eventId: string }) => row.eventId === soon.id));
    assert.ok((await (await request("/api/knowledge/records?type=calendar")).json()).calendar.some((row: { title: string }) => row.title === "Shared upcoming event"));
    assert.equal((await request(`/api/calendar-events/${event.id}`, "PUT", { ...event, summary: "New", expectedVersion: 0 })).status, 409);
    assert.equal((await request("/api/calendar-events", "POST", { ...draft, calendarId: entry.id, noteId: "missing-note" })).status, 400);
    const published = await request(`/api/calendars/${entry.id}/sharing`, "POST", { expectedVersion: 1 });
    const feedPath = (await published.json()).path;
    const feed = await request(feedPath, "GET", undefined, {});
    assert.equal(feed.status, 200);
    assert.equal(feed.headers.get("cache-control"), "no-store");
    assert.match(await feed.text(), /SUMMARY:Planning/);
    assert.equal((await request(feedPath.replace(/key=.*/, "key=" + "b".repeat(64)), "GET", undefined, {})).status, 404);
    assert.equal((await request(`/api/calendars/${entry.id}/sharing`, "DELETE", { expectedVersion: 2 })).status, 200);
    assert.equal((await request(feedPath, "GET", undefined, {})).status, 404);
    assert.equal((await request(`/api/calendar-events/${event.id}`, "DELETE", { expectedVersion: event.version })).status, 200);
    assert.deepEqual(calendar.store.events().map((row) => row.id), [soon.id]);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
