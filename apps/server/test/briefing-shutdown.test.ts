import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";
import {
  buildShutdownReview,
  completedOnChicagoDay,
  dayRangeIso,
  generateShutdownReflection,
  parseClientShutdownReview,
  SHUTDOWN_TZ,
} from "../src/briefing/shutdown-service";
import { dayKey } from "../src/store";
import { slotInstant } from "../src/scheduler";
import { CalendarWorkspace } from "../src/calendar/workspace";
import { DONE } from "../src/board/types";
import { BoardStore } from "../src/board/store";
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "./cf-access-jwt";
import { listCompletedTasks, type TodoistCompletedTask, type TodoistTask } from "../src/todoist/client";
const TOKEN = "t".repeat(32);

function task(id: string, content: string, dueDate: string | null, priority = 1): TodoistTask {
  return {
    id,
    content,
    description: "",
    priority,
    due: dueDate ? { date: dueDate, string: dueDate, datetime: null } : null,
    url: "https://todoist.com/showTask?id=" + id,
  };
}

async function harness(
  env: Record<string, string> = {},
  owner = false,
  verifyJwt?: (token: string) => Promise<import("jose").JWTPayload>,
) {
  const dir = await mkdtemp(join(tmpdir(), "cc-shutdown-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    TZ: "UTC",
    LLM_BASE_URL: "https://api.example/v1",
    LLM_API_KEY: "sk-test",
    LLM_MODEL: "test-model",
    ...env,
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board: integration.board });
  const server = createApp({
    cfg,
    auth: owner
      ? async () => ({ ok: true, who: "owner@example.com", owner: true, email: "owner@example.com" })
      : makeAuthenticator(cfg, verifyJwt),
    settings,
    dailyBriefing,
    notes,
    calendar,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, close, cfg, board: integration.board, calendar };
}

const authz = { authorization: `Bearer ${TOKEN}`, "x-ah": "1" };

test("shutdown: Chicago completion day boundaries under TZ=UTC", () => {
  const day = "2026-10-14";
  assert.equal(completedOnChicagoDay("2026-10-15T04:30:00.000Z", day), true);
  assert.equal(completedOnChicagoDay("2026-10-15T05:30:00.000Z", day), false);
  const range = dayRangeIso(day, SHUTDOWN_TZ);
  assert.equal(range.since, "2026-10-14T05:00:00.000Z");
  assert.equal(range.until, "2026-10-15T05:00:00.000Z");
});

test("todoist: listCompletedTasks uses API v1 by_completion_date with cursor", async () => {
  const calls: string[] = [];
  const fetchFn = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (calls.length === 1) {
      return new Response(
        JSON.stringify({ items: [{ id: "1", content: "A", completed_at: "2026-10-14T12:00:00Z" }], next_cursor: "c2" }),
        { headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ items: [{ id: "2", content: "B", completed_at: "2026-10-14T13:00:00Z" }], next_cursor: null }),
      { headers: { "content-type": "application/json" } },
    );
  };
  const rows = await listCompletedTasks("tok", "2026-10-14T05:00:00Z", "2026-10-15T05:00:00Z", fetchFn);
  assert.equal(rows.length, 2);
  assert.match(calls[0], /api\/v1\/tasks\/completed\/by_completion_date/);
  assert.match(calls[1], /cursor=c2/);
});

test("shutdown: aggregates stubbed Todoist, board done moves, and blocked cards", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-shutdown-agg-"));
  try {
    const cfg = loadConfig({
      DATA_DIR: dir,
      ALLOW_INSECURE_NO_AUTH: "1",
      TZ: "UTC",
      TODOIST_API_TOKEN: "todoist-test-token",
    });
    const notes = await NotesStore.open(dir);
    const integration = await openIntegrationStores(dir, cfg);
    const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board: integration.board });
    const now = new Date();
    const day = dayKey(now, cfg.tz);
    const tomorrow = new Date(`${day}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    const yesterday = new Date(`${day}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayKey = yesterday.toISOString().slice(0, 10);

    const card = integration.board.create({ title: "Ship shutdown", column: "Backlog" });
    await integration.board.move(card.id, DONE);
    const openCard = integration.board.create({ title: "Blocked task", column: "Backlog" });
    const cal = await calendar.create({ kind: "native", name: "Plan", color: "#336699", enabled: true });
    await calendar.saveEvent({
      calendarId: cal.id,
      summary: "Focus block",
      allDay: false,
      timezone: SHUTDOWN_TZ,
      localStart: `${day}T10:00`,
      durationMinutes: 60,
      taskId: openCard.id,
      expectedTaskVersion: openCard.version,
    });

    const completed: TodoistCompletedTask[] = [
      { id: "c1", content: "Done late", completedAt: slotInstant(day, "23:30", cfg.tz).toISOString() },
    ];
    const open: TodoistTask[] = [
      task("t1", "Overdue", yesterdayKey),
      task("t2", "Today open", day),
      task("t3", "Tomorrow due", tomorrowKey),
    ];
    let listCalls = 0;
    const review = await buildShutdownReview({
      cfg,
      board: integration.board,
      calendar,
      now,
      listCompleted: async () => completed,
      fetchFn: async (input) => {
        if (String(input).includes("/api/v1/tasks") && !String(input).includes("completed")) {
          listCalls++;
          const results = open.map((t) => ({
            id: t.id,
            content: t.content,
            description: t.description,
            priority: t.priority,
            due: t.due ? { date: t.due.date, string: t.due.string, datetime: t.due.datetime } : null,
          }));
          return new Response(JSON.stringify({ results, next_cursor: null }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 404 });
      },
    });

    assert.deepEqual(review.done.todoist.map((t) => t.id), ["c1"]);
    assert.equal(review.done.board.length, 1);
    assert.equal(review.unfinished.todoist.overdue.length, 1);
    assert.equal(review.unfinished.todoist.today.length, 1);
    assert.equal(review.unfinished.blockedToday.length, 1);
    assert.equal(review.tomorrowPreview.tasksDue.length, 1);
    assert.equal(listCalls, 1);
    integration.board.close();
    integration.wins.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shutdown: Todoist completed failure does not block open tasks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-shutdown-todoist-"));
  try {
    const cfg = loadConfig({ DATA_DIR: dir, ALLOW_INSECURE_NO_AUTH: "1", TODOIST_API_TOKEN: "x".repeat(32) });
    const integration = await openIntegrationStores(dir, cfg);
    const review = await buildShutdownReview({
      cfg,
      board: integration.board,
      now: new Date("2026-10-14T12:00:00Z"),
      listCompleted: async () => {
        throw new Error("fail");
      },
      fetchFn: async (input) => {
        if (String(input).includes("/api/v1/tasks") && !String(input).includes("completed")) {
          const t = task("t1", "Still open", "2026-10-14");
          return new Response(
            JSON.stringify({
              results: [{ id: t.id, content: t.content, priority: t.priority, due: { date: t.due!.date, string: t.due!.string } }],
              next_cursor: null,
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        return new Response("", { status: 500 });
      },
    });
    assert.equal(review.errors.todoistCompleted, "Couldn't load Todoist completed tasks.");
    assert.equal(review.unfinished.todoist.today.length, 1);
    assert.equal(review.done.todoist.length, 0);
    integration.board.close();
    integration.wins.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shutdown: Todoist open failure still returns completed tasks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-shutdown-todoist-open-"));
  try {
    const cfg = loadConfig({ DATA_DIR: dir, ALLOW_INSECURE_NO_AUTH: "1", TODOIST_API_TOKEN: "x".repeat(32) });
    const integration = await openIntegrationStores(dir, cfg);
    const review = await buildShutdownReview({
      cfg,
      board: integration.board,
      now: new Date("2026-10-14T12:00:00Z"),
      listCompleted: async () => [{ id: "c1", content: "Done", completedAt: "2026-10-14T12:00:00Z" }],
      fetchFn: async (input) => {
        if (String(input).includes("/api/v1/tasks") && !String(input).includes("completed")) {
          return new Response("", { status: 500 });
        }
        return new Response("{}", { status: 404 });
      },
    });
    assert.equal(review.errors.todoistOpen, "Couldn't load Todoist open tasks.");
    assert.equal(review.done.todoist.length, 1);
    assert.equal(review.unfinished.todoist.today.length, 0);
    integration.board.close();
    integration.wins.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shutdown: parseClientShutdownReview rejects malformed payloads", () => {
  assert.equal(parseClientShutdownReview({ review: { done: {}, unfinished: {} } }), null);
  const valid = {
    zone: SHUTDOWN_TZ,
    day: "2026-10-14",
    tomorrow: "2026-10-15",
    generatedAt: "2026-10-14T12:00:00.000Z",
    todoistConfigured: true,
    llmEnabled: true,
    done: { todoist: [], board: [] },
    unfinished: { todoist: { overdue: [], today: [] }, blockedToday: [] },
    time: { calendarHours: 1, blockedTaskHours: 0.5 },
    tomorrowPreview: { events: [], tasksDue: [] },
    errors: {},
  };
  assert.ok(parseClientShutdownReview({ review: valid }));
  assert.equal(parseClientShutdownReview({ review: { ...valid, time: { calendarHours: "bad", blockedTaskHours: 0 } } }), null);
});

test("shutdown: calendar planning failure is isolated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-shutdown-plan-"));
  try {
    const cfg = loadConfig({ DATA_DIR: dir, ALLOW_INSECURE_NO_AUTH: "1" });
    const integration = await openIntegrationStores(dir, cfg);
    const calendar = {
      planning: () => {
        throw new Error("planning failed");
      },
      snapshot: async () => ({ events: [], configured: true, timezone: "UTC", feeds: [], truncated: false }),
    } as unknown as CalendarWorkspace;
    const review = await buildShutdownReview({
      cfg,
      board: integration.board,
      calendar,
      now: new Date("2026-10-14T12:00:00Z"),
    });
    assert.equal(review.errors.calendar, "Couldn't load calendar.");
    integration.board.close();
    integration.wins.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shutdown: calendar snapshot failure is isolated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-shutdown-cal-"));
  try {
    const cfg = loadConfig({ DATA_DIR: dir, ALLOW_INSECURE_NO_AUTH: "1" });
    const integration = await openIntegrationStores(dir, cfg);
    const calendar = {
      planning: () => ({ cards: [], blocks: [], timezone: "UTC" }),
      snapshot: async () => {
        throw new Error("calendar down");
      },
    } as unknown as CalendarWorkspace;
    const review = await buildShutdownReview({
      cfg,
      board: integration.board,
      calendar,
      now: new Date("2026-10-14T12:00:00Z"),
    });
    assert.equal(review.errors.calendar, "Couldn't load calendar.");
    assert.equal(review.tomorrowPreview.events.length, 0);
    integration.board.close();
    integration.wins.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shutdown: reflection only when POST is called", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-shutdown-llm-"));
  try {
    const cfg = loadConfig({
      DATA_DIR: dir,
      ALLOW_INSECURE_NO_AUTH: "1",
      TZ: "UTC",
      LLM_BASE_URL: "https://api.example/v1",
      LLM_API_KEY: "sk-test",
      LLM_MODEL: "test-model",
    });
    const integration = await openIntegrationStores(dir, cfg);
    const notes = await NotesStore.open(dir);
    const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board: integration.board });
    const now = new Date("2026-10-14T12:00:00Z");
    const review = await buildShutdownReview({
      cfg,
      board: integration.board,
      calendar,
      now,
      listCompleted: async () => [],
      fetchFn: async () => new Response("[]", { headers: { "content-type": "application/json" } }),
    });
    assert.equal(review.llmEnabled, true);
    let llmCalls = 0;
    const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/chat/completions")) {
        llmCalls++;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "You closed the loop on the essentials." } }] }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response("[]", { headers: { "content-type": "application/json" } });
    };
    await buildShutdownReview({
      cfg,
      board: integration.board,
      calendar,
      now,
      listCompleted: async () => [],
      fetchFn,
    });
    assert.equal(llmCalls, 0);

    const source = {
      day: review.day,
      zone: SHUTDOWN_TZ as typeof SHUTDOWN_TZ,
      doneTodoist: review.done.todoist.length,
      doneBoard: review.done.board.length,
      openCount: 0,
      calendarHours: review.time.calendarHours,
      blockedHours: review.time.blockedTaskHours,
      tomorrowEvents: review.tomorrowPreview.events.length,
      tomorrowTasksDue: review.tomorrowPreview.tasksDue.length,
    };
    const reflection = await generateShutdownReflection(source, cfg, fetchFn);
    assert.equal(reflection, "You closed the loop on the essentials.");
    assert.equal(llmCalls, 1);
    integration.board.close();
    integration.wins.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shutdown API: GET canManage; reflection requires owner not admin token", async () => {
  const keys = await createTestCfAccessJwt();
  const locked = await harness(
    { OWNER_EMAILS: "owner@example.com", CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM, CF_ACCESS_AUD: TEST_CF_AUD },
    false,
    keys.verifier,
  );
  try {
    const visitorJwt = await keys.signEmailJwt("visitor@example.com");
    const visitorHeaders = { "cf-access-jwt-assertion": visitorJwt, "x-ah": "1" };
    const denied = await fetch(`${locked.base}/api/briefing/shutdown`, { headers: visitorHeaders });
    assert.equal(denied.status, 403);
    const adminGet = await fetch(`${locked.base}/api/briefing/shutdown`, { headers: authz });
    assert.equal(adminGet.status, 200);
    const adminReflect = await fetch(`${locked.base}/api/briefing/shutdown/reflection`, {
      method: "POST",
      headers: authz,
      body: JSON.stringify({ review: (await adminGet.json()).review }),
    });

    assert.equal(adminReflect.status, 403);
  } finally {
    await locked.close();
  }

  const ownerHarness = await harness({ OWNER_EMAILS: "owner@example.com" }, true);
  try {
    const ok = await fetch(`${ownerHarness.base}/api/briefing/shutdown`, { headers: { "x-ah": "1" } });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.review.zone, "UTC");
    const reflect = await fetch(`${ownerHarness.base}/api/briefing/shutdown/reflection`, {
      method: "POST",
      headers: { "x-ah": "1", "content-type": "application/json" },
      body: JSON.stringify({ review: body.review }),
    });
    assert.equal(reflect.status, 200);
    const badReflect = await fetch(`${ownerHarness.base}/api/briefing/shutdown/reflection`, {
      method: "POST",
      headers: { "x-ah": "1", "content-type": "application/json" },
      body: JSON.stringify({ review: { done: {}, unfinished: {} } }),
    });
    assert.equal(badReflect.status, 400);
  } finally {
    await ownerHarness.close();
  }
});

test("shutdown native tasks: due/scheduled union, completion dedup, disjoint time totals and date-only tomorrow", async () => {
      const dir = await mkdtemp(join(tmpdir(), "cc-shutdown-native-"));
      const board = BoardStore.open(dir);
      try {
        const cfg = loadConfig({ DATA_DIR: dir, ALLOW_INSECURE_NO_AUTH: "1", TZ: "Asia/Tokyo" });
        const now = new Date(), day = dayKey(now, cfg.tz);
        const tomorrowDate = new Date(day + "T12:00:00Z"); tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
        const tomorrow = tomorrowDate.toISOString().slice(0, 10);
        const notes = await NotesStore.open(dir);
        const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board });
        const native = await calendar.create({ kind: "native", name: "Plan" });
        const due = board.create({ title: "Due and scheduled", dueDate: day });
        const done = board.create({ title: "Done once", dueDate: day });
        await board.move(done.id, DONE); await board.move(done.id, "Backlog"); await board.move(done.id, DONE);
        const reopened = board.create({ title: "Reopened" });
        await board.move(reopened.id, DONE); await board.move(reopened.id, "Backlog");
        const tomorrowTask = board.create({ title: "Tomorrow", dueDate: tomorrow });
        for (const hour of ["09", "11"]) await calendar.saveEvent({ calendarId: native.id, summary: "Task block", timezone: cfg.tz, allDay: false, localStart: `${day}T${hour}:00`, durationMinutes: 60, taskId: due.id, expectedTaskVersion: due.version });
        await calendar.saveEvent({ calendarId: native.id, summary: "Meeting", timezone: cfg.tz, allDay: false, localStart: `${day}T15:00`, durationMinutes: 60 });
        await calendar.saveEvent({ calendarId: native.id, summary: "Tomorrow date", timezone: cfg.tz, allDay: true, start: tomorrow, end: new Date(tomorrowDate.getTime() + 86_400_000).toISOString().slice(0, 10) });
        const review = await buildShutdownReview({ cfg, board, calendar, now });
        assert.equal(review.zone, cfg.tz);
        assert.deepEqual(review.done.board.map((task) => task.cardId), [done.id]);
        assert.equal(review.unfinished.blockedToday.length, 1);
        assert.equal(review.unfinished.blockedToday[0]?.cardId, due.id);
        assert.equal(review.unfinished.blockedToday[0]?.scheduled, true);
        assert.equal(review.time.calendarHours, 1);
        assert.equal(review.time.blockedTaskHours, 2);
        assert.equal(review.tomorrowPreview.nativeTasksDue[0]?.cardId, tomorrowTask.id);
        assert.ok(review.tomorrowPreview.events.some((event) => event.start === tomorrow && event.allDay));
        const reflection = parseClientShutdownReview({ review }, cfg.tz);
        assert.equal(reflection?.openCount, 1);
        assert.equal(reflection?.tomorrowTasksDue, 1);
      } finally { board.close(); await rm(dir, { recursive: true, force: true }); }
    });

    test("shutdown windows are exclusive local days across DST, including 23/25-hour all-day dates", async () => {
      assert.equal((Date.parse(dayRangeIso("2026-03-08", "America/Los_Angeles").until) - Date.parse(dayRangeIso("2026-03-08", "America/Los_Angeles").since)) / 3_600_000, 23);
      assert.equal((Date.parse(dayRangeIso("2026-11-01", "America/Los_Angeles").until) - Date.parse(dayRangeIso("2026-11-01", "America/Los_Angeles").since)) / 3_600_000, 25);
      const dir = await mkdtemp(join(tmpdir(), "cc-shutdown-dst-")), board = BoardStore.open(dir);
      try {
        const cfg = loadConfig({ DATA_DIR: dir, ALLOW_INSECURE_NO_AUTH: "1", TZ: "America/Los_Angeles", TODOIST_API_TOKEN: "mock" });
        const notes = await NotesStore.open(dir), calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board });
        const native = await calendar.create({ kind: "native", name: "Dates" });
        await calendar.saveEvent({ calendarId: native.id, summary: "DST date", timezone: cfg.tz, allDay: true, start: "2026-11-01", end: "2026-11-02" });
        const range = dayRangeIso("2026-11-01", cfg.tz);
        const review = await buildShutdownReview({ cfg, board, calendar, now: new Date("2026-11-01T20:00:00Z"),
          listCompleted: async (_token, since, until) => {
            assert.deepEqual({ since, until }, range);
            return [{ id: "included", content: "Start inclusive", completedAt: since }, { id: "excluded", content: "End exclusive", completedAt: until }];
          },
          fetchFn: async () => new Response(JSON.stringify({ results: [], next_cursor: null })),
        });
        assert.equal(review.time.calendarHours, 25);
        assert.deepEqual(review.done.todoist.map((task) => task.id), ["included"]);
        assert.equal(review.tomorrowPreview.events.length, 0);
        assert.ok(parseClientShutdownReview({ review }, cfg.tz));
      } finally { board.close(); await rm(dir, { recursive: true, force: true }); }
    });
