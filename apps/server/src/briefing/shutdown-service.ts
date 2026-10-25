import type { BoardStore } from "../board/store";
import { DONE } from "../board/types";
import type { CalendarWorkspace } from "../calendar/workspace";
import { zonedParts } from "../calendar/store";
import type { CalendarEvent } from "../calendar/parse-ics";
import type { Config } from "../config";
import { llmConfig, todoistConfigured } from "../config";
import { dayKeyFromIso } from "../heatmap/counts";
import { chatCompletion, type FetchLike } from "../llm/provider";
import { slotInstant } from "../scheduler";
import { dayKey } from "../store";
import {
  listCompletedTasks,
  listTasks,
  partitionTodayAndOverdue,
  taskDueDay,
  type TodoistCompletedTask,
  type TodoistTask,
} from "../todoist/client";

export const SHUTDOWN_TZ = "America/Chicago";

export type CompletedTasksFetcher = (
  token: string,
  since: string,
  until: string,
  fetchFn?: FetchLike,
) => Promise<TodoistCompletedTask[]>;

export interface ShutdownReview {
  zone: typeof SHUTDOWN_TZ;
  day: string;
  tomorrow: string;
  generatedAt: string;
  todoistConfigured: boolean;
  done: {
    todoist: TodoistCompletedTask[];
    board: Array<{ cardId: string; title: string; at: string }>;
  };
  unfinished: {
    todoist: { overdue: TodoistTask[]; today: TodoistTask[] };
    blockedToday: Array<{ cardId: string; title: string; blockStart: string }>;
  };
  time: { calendarHours: number; blockedTaskHours: number };
  tomorrowPreview: {
    events: Array<{ summary: string; start: string; allDay: boolean }>;
    tasksDue: TodoistTask[];
  };
  llmEnabled: boolean;
}

function nextDayKey(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function dayRangeIso(day: string, tz: string): { since: string; until: string } {
  const since = slotInstant(day, "00:00", tz).toISOString();
  const until = slotInstant(nextDayKey(day), "00:00", tz).toISOString();
  return { since, until };
}

export function completedOnChicagoDay(completedAt: string, day: string): boolean {
  return dayKeyFromIso(completedAt, SHUTDOWN_TZ) === day;
}

function hoursFromMs(ms: number): number {
  return Math.round((ms / 3_600_000) * 100) / 100;
}

function clipEventMsOnDay(event: CalendarEvent, day: string, tz: string): number {
  if (!event.end) return 0;
  const dayStart = slotInstant(day, "00:00", tz).getTime();
  const dayEnd = slotInstant(nextDayKey(day), "00:00", tz).getTime();
  let startMs: number;
  let endMs: number;
  if (event.allDay) {
    startMs = slotInstant(event.start.toISOString().slice(0, 10), "00:00", tz).getTime();
    const endDay = event.end.toISOString().slice(0, 10);
    endMs = slotInstant(endDay, "00:00", tz).getTime();
  } else {
    startMs = event.start.getTime();
    endMs = event.end.getTime();
  }
  const clipStart = Math.max(startMs, dayStart);
  const clipEnd = Math.min(endMs, dayEnd);
  return Math.max(0, clipEnd - clipStart);
}

function blockOnChicagoDay(block: { start: string; end: string; allDay: boolean; timezone: string }, day: string): boolean {
  if (block.allDay) {
    const startDay = block.start.slice(0, 10);
    const endDay = block.end.slice(0, 10);
    return startDay <= day && endDay > day;
  }
  const startDay = zonedParts(block.start, block.timezone).day;
  const endDay = zonedParts(block.end, block.timezone).day;
  return startDay === day || endDay === day || (startDay < day && endDay > day);
}

function blockDurationMsOnDay(block: { start: string; end: string; allDay: boolean; timezone: string }, day: string): number {
  const dayStart = slotInstant(day, "00:00", SHUTDOWN_TZ).getTime();
  const dayEnd = slotInstant(nextDayKey(day), "00:00", SHUTDOWN_TZ).getTime();
  let startMs: number;
  let endMs: number;
  if (block.allDay) {
    startMs = slotInstant(block.start.slice(0, 10), "00:00", block.timezone).getTime();
    endMs = slotInstant(block.end.slice(0, 10), "00:00", block.timezone).getTime();
  } else {
    startMs = Date.parse(block.start);
    endMs = Date.parse(block.end);
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.min(endMs, dayEnd) - Math.max(startMs, dayStart));
}

export async function buildShutdownReview(opts: {
  cfg: Config;
  board: BoardStore;
  calendar?: CalendarWorkspace;
  now: Date;
  listCompleted?: CompletedTasksFetcher;
  fetchFn?: FetchLike;
}): Promise<ShutdownReview> {
  const fetchFn = opts.fetchFn ?? fetch;
  const day = dayKey(opts.now, SHUTDOWN_TZ);
  const tomorrow = nextDayKey(day);
  const { since } = dayRangeIso(day, SHUTDOWN_TZ);

  const doneBoard = opts.board
    .movesSince(since)
    .filter((m) => m.toCol === DONE && dayKeyFromIso(m.at, SHUTDOWN_TZ) === day)
    .map((m) => ({ cardId: m.cardId, title: m.title, at: m.at }));

  let doneTodoist: TodoistCompletedTask[] = [];
  let openTasks: TodoistTask[] = [];
  if (todoistConfigured(opts.cfg) && opts.cfg.todoistApiToken) {
    try {
      const range = dayRangeIso(day, SHUTDOWN_TZ);
      const listCompleted = opts.listCompleted ?? listCompletedTasks;
      const completed = await listCompleted(opts.cfg.todoistApiToken, range.since, range.until, fetchFn);
      doneTodoist = completed.filter((t) => completedOnChicagoDay(t.completedAt, day));
      openTasks = await listTasks(opts.cfg.todoistApiToken, fetchFn);
    } catch {
      doneTodoist = [];
      openTasks = [];
    }
  }

  const { overdue, today } = partitionTodayAndOverdue(openTasks, opts.now, SHUTDOWN_TZ);

  const planning = opts.calendar?.planning();
  const cardsById = new Map((planning?.cards ?? []).map((c) => [c.id, c]));
  const blockedToday: ShutdownReview["unfinished"]["blockedToday"] = [];
  let blockedMs = 0;
  for (const block of planning?.blocks ?? []) {
    if (!block.taskId || block.enabled === false) continue;
    if (!blockOnChicagoDay(block, day)) continue;
    const card = cardsById.get(block.taskId);
    if (!card || card.column === DONE) continue;
    blockedToday.push({ cardId: block.taskId, title: card.title, blockStart: block.start });
    blockedMs += blockDurationMsOnDay(block, day);
  }

  let calendarMs = 0;
  let tomorrowEvents: ShutdownReview["tomorrowPreview"]["events"] = [];
  if (opts.calendar) {
    const rangeStart = slotInstant(day, "00:00", SHUTDOWN_TZ);
    const rangeEnd = slotInstant(nextDayKey(tomorrow), "00:00", SHUTDOWN_TZ);
    const snap = await opts.calendar.snapshot({ rangeStart, rangeEnd, limit: 500 });
    for (const ev of snap.events) {
      calendarMs += clipEventMsOnDay(ev, day, SHUTDOWN_TZ);
    }
    tomorrowEvents = snap.events
      .filter((ev) => {
        const key = ev.allDay ? ev.start.toISOString().slice(0, 10) : dayKey(ev.start, SHUTDOWN_TZ);
        return key === tomorrow;
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .slice(0, 3)
      .map((ev) => ({
        summary: ev.summary,
        start: ev.allDay ? ev.start.toISOString().slice(0, 10) : ev.start.toISOString(),
        allDay: ev.allDay,
      }));
  }

  const tasksDueTomorrow = openTasks
    .filter((t) => taskDueDay(t, SHUTDOWN_TZ) === tomorrow)
    .sort((a, b) => b.priority - a.priority || a.content.localeCompare(b.content));

  return {
    zone: SHUTDOWN_TZ,
    day,
    tomorrow,
    generatedAt: opts.now.toISOString(),
    todoistConfigured: todoistConfigured(opts.cfg),
    done: { todoist: doneTodoist, board: doneBoard },
    unfinished: { todoist: { overdue, today }, blockedToday },
    time: { calendarHours: hoursFromMs(calendarMs), blockedTaskHours: hoursFromMs(blockedMs) },
    tomorrowPreview: { events: tomorrowEvents, tasksDue: tasksDueTomorrow },
    llmEnabled: Boolean(llmConfig(opts.cfg)),
  };
}

export async function generateShutdownReflection(
  review: ShutdownReview,
  cfg: Config,
  fetchFn: FetchLike = fetch,
): Promise<string | null> {
  const llm = llmConfig(cfg);
  if (!llm) return null;
  const doneCount = review.done.todoist.length + review.done.board.length;
  const openCount =
    review.unfinished.todoist.overdue.length
    + review.unfinished.todoist.today.length
    + review.unfinished.blockedToday.length;
  const prompt = [
    `Shutdown review for ${review.day} (${review.zone}).`,
    `Completed: ${doneCount} items (${review.done.todoist.length} Todoist, ${review.done.board.length} board).`,
    `Still open from today's plan: ${openCount}.`,
    `Calendar ${review.time.calendarHours}h vs blocked tasks ${review.time.blockedTaskHours}h.`,
    `Tomorrow: ${review.tomorrowPreview.events.length} early events, ${review.tomorrowPreview.tasksDue.length} tasks due.`,
  ].join(" ");
  try {
    const text = await chatCompletion(
      llm,
      [
        {
          role: "system",
          content: "Write 2–3 short sentences reflecting on the day for one person. Plain text, warm and practical, no markdown.",
        },
        { role: "user", content: prompt },
      ],
      fetchFn,
    );
    return text.trim() || null;
  } catch {
    return null;
  }
}
