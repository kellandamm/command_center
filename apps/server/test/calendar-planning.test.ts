import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AddressInfo } from "node:net";
import { BoardStore } from "../src/board/store";
import { CalendarWorkspace } from "../src/calendar/workspace";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const draft = { summary: "Task block", allDay: false, timezone: "America/Chicago", localStart: "2030-06-10T09:00", durationMinutes: 45 };

test("planning: additive migration preserves legacy identity, metadata, versions and restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-planning-migration-"));
  const db = new DatabaseSync(join(dir, "rss.sqlite"));
  db.exec(`CREATE TABLE cards (id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', column TEXT NOT NULL, position INTEGER NOT NULL, hobie_task_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO cards VALUES ('legacy-id', 'Keep identity', 'Original notes', 'Waiting', 4, 'queue-id', '2026-01-01', '2026-01-01');`);
  db.close();
  let board = BoardStore.open(dir);
  try {
    const old = board.get("legacy-id")!;
    assert.deepEqual([old.id, old.notes, old.position, old.hobieTaskId, old.version, old.priority, old.dueDate, old.estimatedMinutes], ["legacy-id", "Original notes", 4, "queue-id", 1, "normal", null, null]);
    const updated = board.updateMeta(old.id, { estimatedMinutes: 90, dueDate: "2030-06-10", priority: "high" })!;
    assert.equal(updated.version, 2);
    board.close(); board = BoardStore.open(dir);
    assert.deepEqual(board.get(old.id), updated);
    assert.throws(() => board.checkVersion(old.id, old.version), /changed elsewhere/);
    for (const estimatedMinutes of [0, -1, 1.5, 1441, "30", NaN]) assert.throws(() => board.updateMeta(old.id, { estimatedMinutes }));
    for (const dueDate of ["2030-02-30", "", 123]) assert.throws(() => board.updateMeta(old.id, { dueDate }));
    assert.throws(() => board.updateMeta(old.id, { priority: "urgent" }));
    assert.deepEqual(board.get(old.id), updated);
  } finally { board.close(); await rm(dir, { recursive: true, force: true }); }
});

test("planning: native links, multiple blocks, DST durations, orphan recovery and preview boundaries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-planning-"));
  const board = BoardStore.open(dir);
  try {
    const cfg = loadConfig({ DATA_DIR: dir, ALLOW_INSECURE_NO_AUTH: "1", TZ: "America/Chicago" });
    const notes = await NotesStore.open(dir);
    const space = await notes.createSpace({ name: "Planning" });
    const note = await notes.createNote({ title: "Task notes", content: "Keep this link", spaceId: space.id });
    let calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board });
    const native = await calendar.create({ name: "Focus", kind: "native" });
    const task = board.create({ title: "Existing task", estimatedMinutes: 45, dueDate: "2030-06-10", priority: "high" });
    const body = { ...draft, calendarId: native.id, taskId: task.id, expectedTaskVersion: task.version, noteId: note.id, spaceId: space.id };
    await assert.rejects(calendar.saveEvent({ ...body, expectedTaskVersion: 0 }), /changed elsewhere/);
    await assert.rejects(calendar.saveEvent({ ...body, taskId: "missing" }), /no longer exists/);
    const preview = await calendar.preview(body);
    assert.deepEqual(preview.warnings, []);
    assert.equal(preview.event.end, "2030-06-10T14:45:00.000Z");
    assert.equal(calendar.store.events().length, 0);
    const first = await calendar.saveEvent(body), second = await calendar.saveEvent(body);
    assert.notEqual(first.id, second.id);
    assert.equal(first.taskId, task.id);
    assert.equal(first.noteId, note.id);
    assert.equal(first.spaceId, space.id);
    assert.equal(board.get(task.id)?.column, "Backlog");
    assert.ok(calendar.planning().cards.find((row) => row.id === task.id)?.scheduled);
    assert.match((await calendar.preview(body)).warnings.join(" "), /2 event\(s\) overlap/);
    const adjacent = { ...body, localStart: "2030-06-10T09:45" };
    assert.deepEqual((await calendar.preview(adjacent)).warnings, []);
    assert.match((await calendar.preview({ ...adjacent, bufferMinutes: 1 })).warnings.join(" "), /overlap/);
    assert.match((await calendar.preview({ ...body, localStart: "2030-06-10T08:59" })).warnings.join(" "), /working hours/);
    assert.match((await calendar.preview({ ...body, bufferMinutes: 1 })).warnings.join(" "), /working hours/);
    assert.deepEqual((await calendar.preview({ ...body, localStart: "2030-06-10T16:15" })).warnings, []);
    assert.match((await calendar.preview({ ...body, localStart: "2030-06-08T09:00" })).warnings.join(" "), /working hours/);
    for (const changes of [
      { durationMinutes: 0 }, { durationMinutes: 1441 }, { durationMinutes: 1.2 }, { durationMinutes: "30" },
      { timezone: "Not/AZone" }, { timezone: "+03:00" }, { localStart: "2030-03-10T02:30" },
      { workStart: "17:00", workEnd: "09:00" }, { bufferMinutes: -1 }, { bufferMinutes: 121 },
    ]) await assert.rejects(calendar.preview({ ...body, ...changes }));
    const spring = await calendar.saveEvent({ ...body, localStart: "2030-03-10T01:30", durationMinutes: 120 });
    assert.equal(spring.start, "2030-03-10T07:30:00.000Z");
    assert.equal(spring.end, "2030-03-10T09:30:00.000Z");
    const fall = await calendar.saveEvent({ ...body, localStart: "2030-11-03T01:30", durationMinutes: 120 });
    assert.equal(fall.start, "2030-11-03T06:30:00.000Z");
    assert.equal(fall.end, "2030-11-03T08:30:00.000Z");
    const moved = await calendar.saveEvent({ ...first, localStart: "2030-06-11T10:00", durationMinutes: 90, expectedVersion: first.version, expectedTaskVersion: task.version }, first.id);
    assert.equal(moved.id, first.id);
    assert.equal(moved.end, "2030-06-11T16:30:00.000Z");
    await assert.rejects(calendar.saveEvent({ ...first, expectedVersion: 1, expectedTaskVersion: task.version }, first.id), /changed elsewhere/);
    calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board });
    assert.equal(calendar.store.event(first.id)?.end, moved.end);
    await calendar.store.update(native.id, { expectedVersion: native.version, enabled: false });
    assert.equal(calendar.planning().cards.find((row) => row.id === task.id)?.scheduled, false);
    assert.equal(calendar.planning().blocks.length, 4);
    const db = new DatabaseSync(join(dir, "rss.sqlite"));
    db.prepare("DELETE FROM cards WHERE id = ?").run(task.id); db.close();
    calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board });
    assert.equal(calendar.planning().blocks.every((row) => row.orphaned), true);
    await assert.rejects(calendar.saveEvent({ ...moved, expectedVersion: moved.version, expectedTaskVersion: task.version }, moved.id), /no longer exists/);
    const unlinked = await calendar.saveEvent({ ...moved, taskId: null, expectedVersion: moved.version }, moved.id);
    assert.equal(unlinked.taskId, null);
    assert.equal(calendar.planning().blocks.length, 3);
  } finally { board.close(); await rm(dir, { recursive: true, force: true }); }
});

test("planning: recurring and all-day task reservations remain scheduled through their local exclusive ends", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cc-planning-remaining-"));
  const board = BoardStore.open(dir);
  t.mock.method(Date, "now", () => Date.parse("2030-06-11T03:00:00Z"));
  try {
    const cfg = loadConfig({ DATA_DIR: dir, ALLOW_INSECURE_NO_AUTH: "1", TZ: "America/Chicago" });
    const notes = await NotesStore.open(dir), calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board });
    const native = await calendar.create({ name: "Focus", kind: "native" });
    const task = board.create({ title: "All-day reservation" }), recurring = board.create({ title: "Recurring reservation" });
    await calendar.saveEvent({ summary: task.title, calendarId: native.id, allDay: true, timezone: cfg.tz, start: "2030-06-10", end: "2030-06-11", taskId: task.id, expectedTaskVersion: task.version });
    await calendar.saveEvent({ ...draft, calendarId: native.id, recurrence: "daily", repeatUntil: "2030-06-12", taskId: recurring.id, expectedTaskVersion: recurring.version });
    assert.equal(calendar.planning().cards.find((row) => row.id === task.id)?.scheduled, true);
    assert.equal(calendar.planning().cards.find((row) => row.id === recurring.id)?.scheduled, true);
    t.mock.method(Date, "now", () => Date.parse("2030-06-11T05:00:00Z"));
    assert.equal(calendar.planning().cards.find((row) => row.id === task.id)?.scheduled, false);
    assert.equal(calendar.planning().cards.find((row) => row.id === recurring.id)?.scheduled, true);
    t.mock.method(Date, "now", () => Date.parse("2030-06-12T14:45:00Z"));
    assert.equal(calendar.planning().cards.find((row) => row.id === recurring.id)?.scheduled, false);
  } finally { board.close(); await rm(dir, { recursive: true, force: true }); }
});

test("planning: all-day exclusive ends and unavailable calendar warnings use selected timezone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-planning-days-"));
  try {
    const cfg = loadConfig({ DATA_DIR: dir, ALLOW_INSECURE_NO_AUTH: "1", TZ: "Pacific/Kiritimati", ICS_LOCAL_FILES: join(dir, "missing.ics") });
    const calendar = await CalendarWorkspace.open(cfg);
    const native = await calendar.create({ kind: "native", name: "Days" });
    await calendar.saveEvent({ summary: "All-day busy", calendarId: native.id, allDay: true, timezone: cfg.tz, start: "2030-06-10", end: "2030-06-11" });
    const body = { ...draft, timezone: cfg.tz, calendarId: native.id };
    assert.match((await calendar.preview(body)).warnings.join(" "), /overlap.*All-day busy/);
    assert.match((await calendar.preview(body)).warnings.join(" "), /incomplete/);
    assert.doesNotMatch((await calendar.preview({ ...body, localStart: "2030-06-11T00:00" })).warnings.join(" "), /overlap/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("planning APIs: owner/CSRF boundaries, Board conflicts, schedule/reschedule/complete and Wins/Queue independence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-planning-api-"));
  const token = "t".repeat(32), cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: token, OWNER_EMAILS: "owner@example.com", TZ: "UTC" });
  const integration = await openIntegrationStores(dir, cfg), notes = await NotesStore.open(dir);
  const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board: integration.board });
  const settings = new SettingsStore(dir); await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const server = createApp({ cfg, ...integration, notes, calendar, settings, dailyBriefing, auth: makeAuthenticator(cfg, async (jwt) => ({
    email: jwt === "ordinary" ? "reader@example.com" : "owner@example.com", ...(jwt === "machine" ? { common_name: "worker" } : {}),
  })) });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { "cf-access-jwt-assertion": "owner", "x-ah": "1", "content-type": "application/json" };
  const request = (path: string, method = "GET", body?: unknown, custom: Record<string, string> = headers) =>
    fetch(base + path, { method, headers: custom, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    const task = (await (await request("/api/board/cards", "POST", { title: "Capture", estimatedMinutes: 30 })).json()).card;
    const native = await calendar.create({ name: "Work", kind: "native" });
    const body = { ...draft, calendarId: native.id, taskId: task.id, expectedTaskVersion: task.version };
    for (const identity of ["ordinary", "machine", "admin"]) {
      const auth: Record<string, string> = identity === "admin" ? { authorization: `Bearer ${token}` } : { "cf-access-jwt-assertion": identity };
      const custom = { ...headers, "cf-access-jwt-assertion": "", ...auth };
      assert.equal((await request("/api/calendars/planning", "GET", undefined, custom)).status, 200);
      assert.equal((await request("/api/calendar-events/preview", "POST", body, custom)).status, 403);
      assert.equal((await request("/api/calendar-events", "POST", body, custom)).status, 403);
    }
    for (const custom of [{ ...headers, "x-ah": "" }, { ...headers, origin: "https://evil.example" }]) {
      assert.equal((await request("/api/calendar-events/preview", "POST", body, custom)).status, 403);
      assert.equal((await request("/api/calendar-events", "POST", body, custom)).status, 403);
      assert.equal((await request("/api/board/cards", "PATCH", { id: task.id, estimatedMinutes: 60, expectedVersion: 1 }, custom)).status, 403);
    }
    assert.equal((await request("/api/calendar-events/preview", "POST", body)).status, 200);
    assert.equal(calendar.store.events().length, 0);
    const scheduled = await request("/api/calendar-events", "POST", body); assert.equal(scheduled.status, 201);
    const event = (await scheduled.json()).event;
    const moved = await request(`/api/calendar-events/${event.id}`, "PUT", { ...body, localStart: "2030-06-11T10:00", durationMinutes: 60, expectedVersion: event.version });
    assert.equal(moved.status, 200);
    assert.equal((await request(`/api/calendar-events/${event.id}`, "PUT", { ...body, expectedVersion: event.version })).status, 409);
    const changed = await request("/api/board/cards", "PATCH", { id: task.id, expectedVersion: task.version, estimatedMinutes: 90 });
    assert.equal(changed.status, 200); const updated = (await changed.json()).card;
    assert.equal((await request("/api/board/cards", "PATCH", { id: task.id, expectedVersion: task.version, priority: "high" })).status, 409);
    assert.equal((await request("/api/calendar-events", "POST", body)).status, 409);
    assert.equal((await request("/api/board/cards", "PATCH", { id: task.id, expectedVersion: updated.version, column: "Done" })).status, 200);
    assert.equal(integration.wins.list().filter((win) => win.ref === task.id).length, 1);
    assert.equal(integration.hobieQueue.list().length, 0);
    assert.equal(calendar.store.events().length, 1);
    const planning = await (await request("/api/calendars/planning")).json();
    assert.equal(planning.cards[0].id, task.id); assert.equal(planning.cards[0].column, "Done");
    assert.equal(planning.blocks[0].taskId, task.id);
  } finally { await closeIntegrationServer(server, integration); await rm(dir, { recursive: true, force: true }); }
});
