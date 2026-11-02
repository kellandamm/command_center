import type { BoardStore } from "../board/store";
import { DONE } from "../board/types";
import type { CalendarWorkspace } from "../calendar/workspace";
import { durationMsOnDay } from "../calendar/day-duration";
import type { Config } from "../config";
import { todoistConfigured } from "../config";
import { dayKey } from "../store";
import {
  listTasks,
  partitionTodayAndOverdue,
  taskDueDay,
} from "../todoist/client";
import type { FetchLike } from "../llm/provider";
import { dayRangeForPlan, type TimedOccurrence } from "./capacity";
import type { DayPlanTaskRef } from "./types";

const DEFAULT_ESTIMATE = 30;

function boardPriorityScore(p: "low" | "normal" | "high"): number {
  if (p === "high") return 3;
  if (p === "normal") return 2;
  return 1;
}

export interface GatheredDayContext {
  day: string;
  tz: string;
  occurrences: TimedOccurrence[];
  tasks: DayPlanTaskRef[];
  allDayLabels: Array<{ title: string }>;
}

export async function gatherDayPlanContext(opts: {
  cfg: Config;
  board: BoardStore;
  calendar?: CalendarWorkspace;
  now: Date;
  day?: string;
  fetchFn?: FetchLike;
}): Promise<GatheredDayContext> {
  const tz = opts.cfg.tz;
  const day = opts.day ?? dayKey(opts.now, tz);
  const { since, until } = dayRangeForPlan(day, tz);
  const occurrences: TimedOccurrence[] = [];
  const allDayLabels: Array<{ title: string }> = [];
  const scheduledBoardIds = new Set<string>();

  if (opts.calendar) {
    const snap = await opts.calendar.snapshot({
      rangeStart: new Date(since),
      rangeEnd: new Date(until),
      limit: 500,
    });
    const blocksById = new Map(opts.calendar.planning().blocks.map((block) => [block.id, block]));
    for (const ev of snap.events) {
      const block = ev.eventId ? blocksById.get(ev.eventId) : undefined;
      if (ev.allDay) {
        if (durationMsOnDay({ start: ev.start, end: ev.end, allDay: true, timezone: ev.timezone ?? tz }, day, tz) > 0) {
          allDayLabels.push({ title: ev.summary });
        }
        continue;
      }
      const ms = durationMsOnDay(
        { start: ev.start, end: ev.end, allDay: false, timezone: ev.timezone ?? block?.timezone ?? tz },
        day,
        tz,
      );
      if (ms <= 0) continue;
      const startMs = ev.start.getTime();
      const endMs = (ev.end ?? ev.start).getTime();
      const isBlock = Boolean(block?.taskId);
      if (isBlock && block?.taskId) scheduledBoardIds.add(block.taskId);
      occurrences.push({ startMs, endMs, isBlock });
    }
  }

  const tasks: DayPlanTaskRef[] = [];
  for (const card of opts.board.list()) {
    if (card.column === DONE) continue;
    if (!card.dueDate || card.dueDate > day) continue;
    tasks.push({
      source: "board",
      id: card.id,
      title: card.title,
      priority: boardPriorityScore(card.priority),
      dueDay: card.dueDate,
      estimateMinutes: card.estimatedMinutes,
      scheduled: scheduledBoardIds.has(card.id),
    });
  }

  if (todoistConfigured(opts.cfg)) {
    try {
      const open = await listTasks(opts.cfg.todoistApiToken!, opts.fetchFn ?? fetch);
      const { overdue, today } = partitionTodayAndOverdue(open, opts.now, tz);
      for (const t of [...overdue, ...today]) {
        tasks.push({
          source: "todoist",
          id: t.id,
          title: t.content,
          priority: t.priority,
          dueDay: taskDueDay(t, tz),
          estimateMinutes: null,
          scheduled: false,
        });
      }
    } catch {
      // Todoist unavailable — board-only plan
    }
  }

  return { day, tz, occurrences, tasks, allDayLabels };
}

export function unscheduledEstimateMinutes(tasks: DayPlanTaskRef[]): number {
  let sum = 0;
  for (const t of tasks) {
    if (t.scheduled) continue;
    sum += t.estimateMinutes ?? DEFAULT_ESTIMATE;
  }
  return sum;
}

export function taskRefKey(source: DayPlanTaskRef["source"], id: string): string {
  return `${source}:${id}`;
}
