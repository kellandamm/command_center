import type { BoardStore } from "../board/store";
import type { CalendarWorkspace } from "../calendar/workspace";
import type { Config } from "../config";
import { dayKey } from "../store";
import { gatherDayPlanContext, type GatheredDayContext } from "./gather";
import { buildDeterministicPlan, computeRolledAtRead, rollBoostForToday } from "./planner";
import { rankTasks } from "./score";
import { DayPlanStore } from "./store";
import type { DayPlanSnapshot, DayPlanTaskRef } from "./types";
import { DayPlanNotFoundError, assertValidWorkWindow, resolvePlanPrefs } from "./validate";

function previousDayKey(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function storedPrefs(existing: DayPlanSnapshot | null) {
  return existing
    ? { workStart: existing.workStart, workEnd: existing.workEnd, weekendOverride: existing.weekendOverride }
    : null;
}

export async function generateAndPersistDeterministicPlan(opts: {
  cfg: Config;
  board: BoardStore;
  calendar?: CalendarWorkspace;
  store: DayPlanStore;
  now: Date;
  day?: string;
  workStart?: string;
  workEnd?: string;
  weekendOverride?: boolean;
}): Promise<DayPlanSnapshot> {
  const day = opts.day ?? dayKey(opts.now, opts.cfg.tz);
  const existing = opts.store.load(day);
  const prefs = resolvePlanPrefs(storedPrefs(existing), {
    workStart: opts.workStart,
    workEnd: opts.workEnd,
    weekendOverride: opts.weekendOverride,
  });
  assertValidWorkWindow(prefs.workStart, prefs.workEnd, day, opts.cfg.tz);
  const context = await gatherDayPlanContext({
    cfg: opts.cfg,
    board: opts.board,
    calendar: opts.calendar,
    now: opts.now,
    day,
  });
  const yesterday = previousDayKey(day);
  const prev = opts.store.load(yesterday);
  const rollBoost = prev
    ? rollBoostForToday(computeRolledAtRead(prev.mustDos, context.tasks))
    : new Set<string>();
  const plan = buildDeterministicPlan({
    context,
    rollBoost,
    now: opts.now,
    workStart: prefs.workStart,
    workEnd: prefs.workEnd,
    weekendOverride: prefs.weekendOverride,
  });
  plan.rolledToTomorrow = computeRolledAtRead(plan.mustDos, context.tasks);
  opts.store.save(plan);
  return plan;
}

function rollBoostForDay(store: DayPlanStore, day: string, openTasks: DayPlanTaskRef[]): Set<string> {
  const prev = store.load(previousDayKey(day));
  return prev ? rollBoostForToday(computeRolledAtRead(prev.mustDos, openTasks)) : new Set<string>();
}

export function enrichStoredPlanForRead(
  plan: DayPlanSnapshot,
  context: GatheredDayContext,
  store: DayPlanStore,
  day: string,
): DayPlanSnapshot {
  const rollBoost = rollBoostForDay(store, day, context.tasks);
  const ranked = rankTasks(context.tasks, day, rollBoost);
  const mustDoKeys = new Set(plan.mustDos.map((m) => `${m.source}:${m.refId}`));
  return {
    ...plan,
    sources: context.sources,
    alternates: ranked.filter((t) => !mustDoKeys.has(`${t.source}:${t.id}`)),
    rolledToTomorrow: computeRolledAtRead(plan.mustDos, context.tasks),
  };
}

export async function applyDayPlanEdits(opts: {
  cfg: Config;
  board: BoardStore;
  calendar?: CalendarWorkspace;
  store: DayPlanStore;
  now: Date;
  day: string;
  workStart?: string;
  workEnd?: string;
  weekendOverride?: boolean;
}): Promise<DayPlanSnapshot> {
  const existing = opts.store.load(opts.day);
  if (!existing) throw new DayPlanNotFoundError();
  const prefs = resolvePlanPrefs(storedPrefs(existing), {
    workStart: opts.workStart,
    workEnd: opts.workEnd,
    weekendOverride: opts.weekendOverride,
  });
  assertValidWorkWindow(prefs.workStart, prefs.workEnd, opts.day, opts.cfg.tz);
  const context = await gatherDayPlanContext({
    cfg: opts.cfg,
    board: opts.board,
    calendar: opts.calendar,
    now: opts.now,
    day: opts.day,
  });
  const rollBoost = rollBoostForDay(opts.store, opts.day, context.tasks);
  const plan = buildDeterministicPlan({
    context,
    rollBoost,
    now: opts.now,
    workStart: prefs.workStart,
    workEnd: prefs.workEnd,
    weekendOverride: prefs.weekendOverride,
  });
  plan.rolledToTomorrow = computeRolledAtRead(plan.mustDos, context.tasks);
  opts.store.save(plan);
  return enrichStoredPlanForRead(plan, context, opts.store, opts.day);
}
