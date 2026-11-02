import { taskRefKey } from "./gather";
import type { DayPlanTaskRef } from "./types";

const ROLL_BOOST = 25;

export function scoreTask(task: DayPlanTaskRef, day: string, rollBoost: ReadonlySet<string>): number {
  let score = task.priority * 10;
  if (task.dueDay && task.dueDay < day) score += 40;
  else if (task.dueDay === day) score += 20;
  if (!task.scheduled) score += 5;
  if (rollBoost.has(taskRefKey(task.source, task.id))) score += ROLL_BOOST;
  return score;
}

export function rankTasks(tasks: DayPlanTaskRef[], day: string, rollBoost: ReadonlySet<string>): DayPlanTaskRef[] {
  return tasks.slice().sort((a, b) => scoreTask(b, day, rollBoost) - scoreTask(a, day, rollBoost) || a.title.localeCompare(b.title));
}

export function pickMustDos(ranked: DayPlanTaskRef[], max = 3): DayPlanTaskRef[] {
  const out: DayPlanTaskRef[] = [];
  const seen = new Set<string>();
  for (const t of ranked) {
    const key = taskRefKey(t.source, t.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
