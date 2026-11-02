import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { BoardStore } from "../src/board/store";
import { CalendarWorkspace } from "../src/calendar/workspace";
import { NotesStore } from "../src/notes/store";
import { gatherDayPlanContext } from "../src/day-plan/gather";
import { buildDeterministicPlan, computeRolledAtRead, rollBoostForToday } from "../src/day-plan/planner";
import { pickMustDos, rankTasks } from "../src/day-plan/score";
import { DayPlanStore } from "../src/day-plan/store";
import { generateAndPersistDeterministicPlan } from "../src/day-plan/service";

test("day-plan planner: at most three must-dos and roll boost prefers rolled tasks", () => {
  const tasks = [
    { source: "board" as const, id: "a", title: "A", priority: 1, dueDay: "2026-06-01", estimateMinutes: 30, scheduled: false },
    { source: "board" as const, id: "b", title: "B", priority: 1, dueDay: "2026-06-02", estimateMinutes: 30, scheduled: false },
    { source: "todoist" as const, id: "c", title: "C", priority: 4, dueDay: "2026-06-02", estimateMinutes: null, scheduled: false },
    { source: "todoist" as const, id: "d", title: "D", priority: 4, dueDay: "2026-06-02", estimateMinutes: null, scheduled: false },
  ];
  const boost = rollBoostForToday([tasks[0]!]);
  const ranked = rankTasks(tasks, "2026-06-02", boost);
  assert.equal(ranked[0]?.id, "a");
  assert.equal(pickMustDos(ranked, 3).length, 3);
  assert.equal(pickMustDos(ranked, 3).length, 3);
  assert.equal(pickMustDos(tasks, 3).length, 3);
  assert.equal(pickMustDos(tasks.slice(0, 2), 3).length, 2);
});

test("day-plan planner: break lands in free gap near midpoint", () => {
  const day = "2026-06-04";
  const tz = "America/Chicago";
  const ctx = {
    day,
    tz,
    allDayLabels: [],
    tasks: [],
    occurrences: [
      { startMs: Date.parse(`${day}T14:00:00-05:00`), endMs: Date.parse(`${day}T15:00:00-05:00`), isBlock: false },
    ],
  };
  const plan = buildDeterministicPlan({ context: ctx, now: new Date(`${day}T12:00:00-05:00`) });
  const brk = plan.items.find((i) => i.kind === "break");
  assert.ok(brk?.startIso && brk.endIso);
  const start = Date.parse(brk.startIso);
  const end = Date.parse(brk.endIso);
  assert.equal((end - start) / 60_000, 15);
  assert.ok(start < Date.parse(`${day}T14:00:00-05:00`));
});

test("day-plan integration: store round-trip and rolledToTomorrow at read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-day-plan-"));
  try {
    const store = DayPlanStore.open(dir);
    const cfg = loadConfig({ DATA_DIR: dir, ALLOW_INSECURE_NO_AUTH: "1", TZ: "Asia/Tokyo" });
    const board = BoardStore.open(dir);
    const notes = await NotesStore.open(dir);
    const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board });
    board.create({ title: "Due today", dueDate: "2026-06-05" });
    const now = new Date("2026-06-05T01:00:00Z");
    const plan = await generateAndPersistDeterministicPlan({
      cfg,
      board,
      calendar,
      store,
      now,
      day: "2026-06-05",
    });
    assert.ok(plan.mustDos.length >= 1);
    const loaded = store.load("2026-06-05");
    assert.ok(loaded);
    const context = await gatherDayPlanContext({ cfg, board, calendar, now, day: "2026-06-05" });
    loaded!.rolledToTomorrow = computeRolledAtRead(loaded!.mustDos, context.tasks);
    assert.ok(Array.isArray(loaded!.rolledToTomorrow));
    store.close();
    board.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
