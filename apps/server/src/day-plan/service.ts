import type { BoardStore } from "../board/store";
import type { CalendarWorkspace } from "../calendar/workspace";
import type { Config } from "../config";
import { dayKey } from "../store";
import { gatherDayPlanContext, type GatheredDayContext } from "./gather";
import { buildDeterministicPlan, computeRolledAtRead, rollBoostForToday } from "./planner";
import { rankTasks } from "./score";
import { DayPlanStore } from "./store";
import type { DayPlanSnapshot, DayPlanTaskRef } from "./types";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function previousDayKey(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function generateAndPersistDeterministicPlan(opts: {
  cfg: Config;
  board: BoardStore;
  calendar?: CalendarWorkspace;
  store: DayPlanStore;
  now: Date;
  day?: string;
  weekendOverride?: boolean;
}): Promise<DayPlanSnapshot> {
  const day = opts.day ?? dayKey(opts.now, opts.cfg.tz);
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
    weekendOverride: opts.weekendOverride,
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

export function parseDayPlanPutBody(
  body: unknown,
): { day: string; workStart?: string; workEnd?: string; weekendOverride?: boolean } | null {
  if (typeof body !== "object" || body === null) return null;
  const o = body as Record<string, unknown>;
  if (typeof o.day !== "string" || !DAY_RE.test(o.day)) return null;
  const out: { day: string; workStart?: string; workEnd?: string; weekendOverride?: boolean } = { day: o.day };
  if (typeof o.workStart === "string" && TIME.test(o.workStart)) out.workStart = o.workStart;
  if (typeof o.workEnd === "string" && TIME.test(o.workEnd)) out.workEnd = o.workEnd;
  if (o.weekendOverride === true) out.weekendOverride = true;
  if (o.weekendOverride === false) out.weekendOverride = false;
  return out;
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
  if (!existing) throw new Error("missing plan");
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
    workStart: opts.workStart ?? existing.workStart,
    workEnd: opts.workEnd ?? existing.workEnd,
    weekendOverride: opts.weekendOverride ?? false,
  });
  plan.rolledToTomorrow = computeRolledAtRead(plan.mustDos, context.tasks);
  opts.store.save(plan);
  return enrichStoredPlanForRead(plan, context, opts.store, opts.day);
}
