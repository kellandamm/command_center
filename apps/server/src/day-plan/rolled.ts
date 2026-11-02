import { calendarLocalInstant } from "../calendar/store";
import { clipIntervalToWindow, mergeIntervalMinutes, workWindowBoundsMs } from "./capacity";
import type { TimedOccurrence } from "./capacity";
import type { DayPlanMustDo, DayPlanTaskRef } from "./types";

export function computeRolledToTomorrow(opts: {
  day: string;
  tz: string;
  mustDos: Array<{ source: DayPlanTaskRef["source"]; refId: string; title: string; completedAt: string | null }>;
  openTasks: DayPlanTaskRef[];
}): DayPlanTaskRef[] {
  const openKeys = new Set(opts.openTasks.map((t) => `${t.source}:${t.id}`));
  const rolled: DayPlanTaskRef[] = [];
  for (const m of opts.mustDos) {
    if (m.completedAt) continue;
    const key = `${m.source}:${m.refId}`;
    const task = opts.openTasks.find((t) => `${t.source}:${t.id}` === key);
    if (task) rolled.push(task);
    else {
      rolled.push({
        source: m.source,
        id: m.refId,
        title: m.title,
        priority: 2,
        dueDay: opts.day,
        estimateMinutes: null,
        scheduled: false,
      });
    }
  }
  return rolled.filter((t) => openKeys.has(`${t.source}:${t.id}`) || !opts.openTasks.some((x) => x.id === t.id && x.source === t.source));
}

export function rollBoostKeysFromRolled(rolled: DayPlanTaskRef[]): Set<string> {
  return new Set(rolled.map((t) => `${t.source}:${t.id}`));
}

function mergedBusy(win: { startMs: number; endMs: number }, occurrences: TimedOccurrence[]): Array<[number, number]> {
  const clips: Array<[number, number]> = [];
  for (const occ of occurrences) {
    const clip = clipIntervalToWindow(occ.startMs, occ.endMs, win);
    if (clip) clips.push(clip);
  }
  if (!clips.length) return [];
  const sorted = clips.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  let [a, b] = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const [c, d] = sorted[i]!;
    if (c <= b) b = Math.max(b, d);
    else {
      merged.push([a, b]);
      [a, b] = [c, d];
    }
  }
  merged.push([a, b]);
  return merged;
}

/** Nearest free gap ≥ minGapMs to work-window midpoint. */
export function pickBreakInterval(opts: {
  day: string;
  tz: string;
  workStart: string;
  workEnd: string;
  occurrences: TimedOccurrence[];
  minMinutes?: number;
}): { startIso: string; endIso: string } | null {
  const win = workWindowBoundsMs(opts.day, opts.tz, opts.workStart, opts.workEnd);
  if (!win) return null;
  const minGapMs = (opts.minMinutes ?? 15) * 60_000;
  const midpoint = (win.startMs + win.endMs) / 2;
  const busy = mergedBusy(win, opts.occurrences);
  const gaps: Array<[number, number]> = [];
  let cursor = win.startMs;
  for (const [a, b] of busy) {
    if (a > cursor) gaps.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < win.endMs) gaps.push([cursor, win.endMs]);
  let best: [number, number] | null = null;
  let bestDist = Infinity;
  for (const [a, b] of gaps) {
    if (b - a < minGapMs) continue;
    const start = Math.min(Math.max(a, midpoint - minGapMs / 2), b - minGapMs);
    const end = start + minGapMs;
    const center = (start + end) / 2;
    const dist = Math.abs(center - midpoint);
    if (dist < bestDist) {
      bestDist = dist;
      best = [start, end];
    }
  }
  if (!best) return null;
  return { startIso: new Date(best[0]).toISOString(), endIso: new Date(best[1]).toISOString() };
}

export function mustDosFromTasks(tasks: DayPlanTaskRef[]): DayPlanMustDo[] {
  return tasks.map((t, slot) => ({
    slot,
    source: t.source,
    refId: t.id,
    title: t.title,
    userLocked: false,
    completedAt: null,
  }));
}
