import { randomUUID } from "node:crypto";
import { capacityFromOccurrences } from "./capacity";
import type { GatheredDayContext } from "./gather";
import { unscheduledEstimateMinutes } from "./gather";
import { pickBreakInterval, mustDosFromTasks, rollBoostKeysFromRolled } from "./rolled";
import { pickMustDos, rankTasks } from "./score";
import type { DayPlanItem, DayPlanSnapshot, DayPlanTaskRef } from "./types";

export const DEFAULT_WORK_START = "09:00";
export const DEFAULT_WORK_END = "17:00";

export function buildDeterministicPlan(opts: {
  context: GatheredDayContext;
  workStart?: string;
  workEnd?: string;
  weekendOverride?: boolean;
  rollBoost?: ReadonlySet<string>;
  now?: Date;
}): DayPlanSnapshot {
  const workStart = opts.workStart ?? DEFAULT_WORK_START;
  const workEnd = opts.workEnd ?? DEFAULT_WORK_END;
  const weekendOverride = opts.weekendOverride ?? false;
  const rollBoost = opts.rollBoost ?? new Set<string>();
  const { day, tz, occurrences, tasks, allDayLabels, sources } = opts.context;
  const unscheduled = unscheduledEstimateMinutes(tasks);
  const capacity = capacityFromOccurrences({
    day,
    tz,
    workStart,
    workEnd,
    weekendOverride,
    occurrences,
    unscheduledEstimateMinutes: unscheduled,
  });
  const ranked = rankTasks(tasks, day, rollBoost);
  const mustDoTasks = pickMustDos(ranked, 3);
  const mustDoKeys = new Set(mustDoTasks.map((t) => `${t.source}:${t.id}`));
  const alternates = ranked.filter((t) => !mustDoKeys.has(`${t.source}:${t.id}`));

  const items: DayPlanItem[] = [];
  let order = 0;
  for (const label of allDayLabels) {
    items.push({
      id: randomUUID(),
      kind: "meeting",
      source: null,
      refId: null,
      title: label.title,
      startIso: null,
      endIso: null,
      sortOrder: order++,
      completedAt: null,
    });
  }
  for (const occ of occurrences) {
    items.push({
      id: randomUUID(),
      kind: occ.isBlock ? "block" : "meeting",
      source: null,
      refId: null,
      title: occ.isBlock ? "Board block" : "Meeting",
      startIso: new Date(occ.startMs).toISOString(),
      endIso: new Date(occ.endMs).toISOString(),
      sortOrder: order++,
      completedAt: null,
    });
  }
  const brk =
    capacity.availableMinutes > 0 && (unscheduled > 0 || occurrences.length > 0)
      ? pickBreakInterval({ day, tz, workStart, workEnd, occurrences })
      : null;
  if (brk) {
    items.push({
      id: randomUUID(),
      kind: "break",
      source: null,
      refId: null,
      title: "Break",
      startIso: brk.startIso,
      endIso: brk.endIso,
      sortOrder: order++,
      completedAt: null,
    });
  }

  const mustDos = mustDosFromTasks(mustDoTasks);
  const rolledToTomorrow = computeRolledAtRead(mustDos, tasks);

  return {
    day,
    timezone: tz,
    workStart,
    workEnd,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    generatedBy: "deterministic",
    theme: null,
    capacity,
    sources,
    mustDos,
    items,
    alternates,
    rolledToTomorrow,
  };
}

export function computeRolledAtRead(mustDos: DayPlanSnapshot["mustDos"], openTasks: DayPlanTaskRef[]): DayPlanTaskRef[] {
  const open = new Map(openTasks.map((t) => [`${t.source}:${t.id}`, t] as const));
  const rolled: DayPlanTaskRef[] = [];
  for (const m of mustDos) {
    if (m.completedAt) continue;
    const hit = open.get(`${m.source}:${m.refId}`);
    if (hit) rolled.push(hit);
  }
  return rolled;
}

export function rollBoostForToday(yesterdayRolled: DayPlanTaskRef[]): Set<string> {
  return rollBoostKeysFromRolled(yesterdayRolled);
}
