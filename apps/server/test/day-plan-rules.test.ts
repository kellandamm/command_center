import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { BoardStore } from "../src/board/store";
import { DONE } from "../src/board/types";
import { CalendarWorkspace } from "../src/calendar/workspace";
import { NotesStore } from "../src/notes/store";
import { clipIntervalToWindow, capacityFromOccurrences, workWindowBoundsMs } from "../src/day-plan/capacity";
import { gatherDayPlanContext } from "../src/day-plan/gather";
import { buildDeterministicPlan } from "../src/day-plan/planner";
import { pickBreakInterval } from "../src/day-plan/rolled";
import { pickMustDos } from "../src/day-plan/score";
import { DayPlanStore, __setSaveFailAtItemIndex } from "../src/day-plan/store";
import { DAY_PLAN_SCHEMA_VERSION, initDayPlanSchema } from "../src/day-plan/db";
import { DatabaseSync } from "node:sqlite";

test("rule: all-day events do not add timed occurrences (gather.ts ~57 continue)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dp-allday-"));
  try {
    const cfg = loadConfig({ DATA_DIR: dir, ALLOW_INSECURE_NO_AUTH: "1", TZ: "America/Chicago" });
    const board = BoardStore.open(dir);
    const notes = await NotesStore.open(dir);
    const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board });
    const native = await calendar.create({ kind: "native", name: "Plan" });
    await calendar.saveEvent({
      calendarId: native.id,
      summary: "All day hold",
      timezone: cfg.tz,
      allDay: true,
      start: "2026-06-10",
      end: "2026-06-11",
    });
    await calendar.saveEvent({
      calendarId: native.id,
      summary: "Timed meet",
      timezone: cfg.tz,
      allDay: false,
      localStart: "2026-06-10T10:00",
      durationMinutes: 60,
    });
    const ctx = await gatherDayPlanContext({
      cfg,
      board,
      calendar,
      now: new Date("2026-06-10T15:00:00-05:00"),
      day: "2026-06-10",
    });
    assert.equal(ctx.occurrences.length, 1);
    assert.equal(ctx.allDayLabels.length, 1);
    board.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rule: board excludes Done and dueDate > day", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dp-board-"));
  try {
    const cfg = loadConfig({ DATA_DIR: dir, ALLOW_INSECURE_NO_AUTH: "1", TZ: "UTC" });
    const board = BoardStore.open(dir);
    const done = board.create({ title: "Done card", dueDate: "2026-06-10" });
    await board.move(done.id, DONE);
    board.create({ title: "Future", dueDate: "2026-06-15" });
    board.create({ title: "Due", dueDate: "2026-06-10" });
    const ctx = await gatherDayPlanContext({
      cfg,
      board,
      now: new Date("2026-06-10T12:00:00Z"),
      day: "2026-06-10",
    });
    assert.deepEqual(
      ctx.tasks.map((t) => t.title),
      ["Due"],
    );
    board.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rule: todoist only overdue and today partitions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dp-todoist-"));
  try {
    const cfg = loadConfig({
      DATA_DIR: dir,
      ALLOW_INSECURE_NO_AUTH: "1",
      TZ: "UTC",
      TODOIST_API_TOKEN: "x".repeat(32),
    });
    const board = BoardStore.open(dir);
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          results: [
            { id: "0", content: "Overdue", due: { date: "2026-06-09", string: "2026-06-09" }, priority: 2 },
            { id: "1", content: "Tomorrow", due: { date: "2026-06-11", string: "2026-06-11" }, priority: 1 },
            { id: "2", content: "Today", due: { date: "2026-06-10", string: "2026-06-10" }, priority: 1 },
          ],
          next_cursor: null,
        }),
        { headers: { "content-type": "application/json" } },
      );
    const ctx = await gatherDayPlanContext({
      cfg,
      board,
      now: new Date("2026-06-10T12:00:00Z"),
      day: "2026-06-10",
      fetchFn,
    });
    assert.deepEqual(
      ctx.tasks.map((t) => t.id).sort(),
      ["0", "2"],
    );
    const plan = buildDeterministicPlan({ context: ctx, weekendOverride: true });
    assert.ok(plan.mustDos.some((m) => m.refId === "0" && m.title === "Overdue"));
    board.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rule: clipIntervalToWindow drops events outside work window", () => {
  const day = "2026-06-02";
  const tz = "America/Chicago";
  const win = workWindowBoundsMs(day, tz, "09:00", "17:00")!;
  const before = clipIntervalToWindow(win.startMs - 3_600_000, win.startMs - 1_800_000, win);
  assert.equal(before, null);
  const inside = clipIntervalToWindow(win.startMs + 60_000, win.startMs + 120 * 60_000, win);
  assert.ok(inside);
});

test("rule: capacityFromOccurrences clips event crossing work-window start", () => {
  const day = "2026-06-02";
  const tz = "America/Chicago";
  const win = workWindowBoundsMs(day, tz, "09:00", "17:00")!;
  const cap = capacityFromOccurrences({
    day,
    tz,
    workStart: "09:00",
    workEnd: "17:00",
    weekendOverride: false,
    occurrences: [{ startMs: win.startMs - 60 * 60_000, endMs: win.startMs + 60 * 60_000, isBlock: false }],
    unscheduledEstimateMinutes: 0,
  });
  assert.equal(cap.meetingMinutes, 60);
});

test("rule: pickBreakInterval requires gap >= 15 minutes (rolled.ts ~84)", () => {
  const day = "2026-06-05";
  const tz = "America/Chicago";
  const win = workWindowBoundsMs(day, tz, "09:00", "17:00")!;
  const tenMinGapMs = 10 * 60_000;
  const shortGap = pickBreakInterval({
    day,
    tz,
    workStart: "09:00",
    workEnd: "17:00",
    minMinutes: 15,
    occurrences: [{ startMs: win.startMs, endMs: win.endMs - tenMinGapMs, isBlock: false }],
  });
  assert.equal(shortGap, null);
});

test("rule: pickMustDos caps at three (planner.ts ~36)", () => {
  const tasks = Array.from({ length: 5 }, (_, i) => ({
    source: "board" as const,
    id: String(i),
    title: `T${i}`,
    priority: 1,
    dueDay: "2026-06-01",
    estimateMinutes: 30,
    scheduled: false,
  }));
  assert.equal(pickMustDos(tasks, 3).length, 3);
});

test("rule: overlapping block and meeting occupy once for over-capacity", () => {
  const day = "2026-06-05";
  const tz = "America/Chicago";
  const win = workWindowBoundsMs(day, tz, "09:00", "17:00")!;
  const start = win.startMs + 2 * 60_000;
  const end = start + 60 * 60_000;
  const unscheduled = 430;
  const cap = capacityFromOccurrences({
    day,
    tz,
    workStart: "09:00",
    workEnd: "17:00",
    weekendOverride: false,
    occurrences: [
      { startMs: start, endMs: end, isBlock: false },
      { startMs: start, endMs: end, isBlock: true },
    ],
    unscheduledEstimateMinutes: unscheduled,
  });
  assert.equal(cap.meetingMinutes, 60);
  assert.equal(cap.blockedTaskMinutes, 60);
  assert.equal(cap.overByMinutes, 10);
  assert.ok(cap.meetingMinutes + cap.blockedTaskMinutes > 60);
});

test("rule: calendar and todoist failures set source flags", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dp-src-"));
  try {
    const cfg = loadConfig({
      DATA_DIR: dir,
      ALLOW_INSECURE_NO_AUTH: "1",
      TZ: "UTC",
      TODOIST_API_TOKEN: "x".repeat(32),
    });
    const board = BoardStore.open(dir);
    const calendar = {
      snapshot: async () => {
        throw new Error("down");
      },
      planning: () => ({ blocks: [] }),
    } as unknown as CalendarWorkspace;
    const ctx = await gatherDayPlanContext({
      cfg,
      board,
      calendar,
      now: new Date("2026-06-10T12:00:00Z"),
      fetchFn: async () => new Response("err", { status: 503 }),
    });
    assert.equal(ctx.sources.calendarUnavailable, true);
    assert.equal(ctx.sources.todoistUnavailable, true);
    board.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("day-plan store: failed save rolls back previous plan", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dp-tx-"));
  try {
    const store = DayPlanStore.open(dir);
    const day = "2026-08-01";
    const win = workWindowBoundsMs(day, "UTC", "09:00", "17:00")!;
    const tasks = [
      { source: "board" as const, id: "a", title: "A", priority: 2, dueDay: day, estimateMinutes: 30, scheduled: false },
      { source: "board" as const, id: "b", title: "B", priority: 1, dueDay: day, estimateMinutes: 45, scheduled: false },
      { source: "board" as const, id: "c", title: "C", priority: 1, dueDay: day, estimateMinutes: 30, scheduled: false },
    ];
    const base = buildDeterministicPlan({
      context: {
        day,
        tz: "UTC",
        occurrences: [{ startMs: win.startMs + 60_000, endMs: win.startMs + 90 * 60_000, isBlock: false }],
        tasks,
        allDayLabels: [{ title: "Hold" }],
        sources: { calendarUnavailable: false, todoistUnavailable: false },
      },
      weekendOverride: true,
    });
    assert.ok(base.items.length >= 2);
    assert.equal(base.mustDos.length, 3);
    store.save(base);
    const broken = {
      ...base,
      items: [
        ...base.items,
        {
          id: "x",
          kind: "break" as const,
          source: null,
          refId: null,
          title: "B",
          startIso: null,
          endIso: null,
          sortOrder: 99,
          completedAt: null,
        },
      ],
    };
    __setSaveFailAtItemIndex(1);
    assert.throws(() => store.save(broken));
    __setSaveFailAtItemIndex(null);
    const loaded = store.load(day);
    assert.equal(loaded?.mustDos.length, 3);
    assert.equal(loaded?.items.length, base.items.length);
    assert.deepEqual(
      loaded?.items.map((i) => i.title),
      base.items.map((i) => i.title),
    );
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("day-plan schema user_version", () => {
  const db = new DatabaseSync(":memory:");
  initDayPlanSchema(db);
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  assert.equal(version, DAY_PLAN_SCHEMA_VERSION);
});

test("plan_llm_attempts survives DayPlanStore.save and blocks duplicate claim", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dp-llm-cap-"));
  try {
    const store = DayPlanStore.open(dir);
    const day = "2026-09-01";
    assert.equal(store.claimLlmAttempt(day, "auto", "2026-09-01T08:00:00.000Z"), true);
    assert.equal(store.claimLlmAttempt(day, "auto", "2026-09-01T08:01:00.000Z"), false);
    const plan = buildDeterministicPlan({
      context: {
        day,
        tz: "UTC",
        occurrences: [],
        tasks: [],
        allDayLabels: [],
        sources: { calendarUnavailable: false, todoistUnavailable: false },
      },
      weekendOverride: true,
    });
    store.save(plan);
    assert.equal(store.hasLlmAttempt(day, "auto"), true);
    assert.equal(store.claimLlmAttempt(day, "auto", "2026-09-01T09:00:00.000Z"), false);
    assert.equal(store.claimLlmAttempt(day, "manual", "2026-09-01T10:00:00.000Z"), true);
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("weekend empty plan: no over-capacity and no break", () => {
  const plan = buildDeterministicPlan({
    context: {
      day: "2026-11-07",
      tz: "America/Chicago",
      occurrences: [],
      tasks: [],
      allDayLabels: [],
      sources: { calendarUnavailable: false, todoistUnavailable: false },
    },
  });
  assert.equal(plan.capacity.availableMinutes, 0);
  assert.equal(plan.capacity.overByMinutes, 0);
  assert.ok(!plan.items.some((i) => i.kind === "break"));
});

test("weekend 0h available: keeps meetings, no break, over-capacity when tasks exist", () => {
  const day = "2026-11-07";
  const tz = "America/Chicago";
  const win = workWindowBoundsMs(day, tz, "09:00", "17:00")!;
  const plan = buildDeterministicPlan({
    context: {
      day,
      tz,
      occurrences: [{ startMs: win.startMs + 60_000, endMs: win.startMs + 61 * 60_000, isBlock: false }],
      tasks: [{ source: "board", id: "t1", title: "Sat task", priority: 1, dueDay: day, estimateMinutes: 60, scheduled: false }],
      allDayLabels: [],
      sources: { calendarUnavailable: false, todoistUnavailable: false },
    },
  });
  assert.equal(plan.capacity.availableMinutes, 0);
  assert.ok(plan.items.some((i) => i.kind === "meeting"));
  assert.ok(!plan.items.some((i) => i.kind === "break"));
  assert.ok(plan.capacity.overByMinutes >= 60);
});
