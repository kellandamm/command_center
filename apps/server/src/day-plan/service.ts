import type { BoardStore } from "../board/store";
import type { CalendarWorkspace } from "../calendar/workspace";
import type { Config } from "../config";
import { dayKey } from "../store";
import { gatherDayPlanContext } from "./gather";
import { buildDeterministicPlan, computeRolledAtRead, rollBoostForToday } from "./planner";
import { DayPlanStore } from "./store";
import type { DayPlanSnapshot } from "./types";

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
