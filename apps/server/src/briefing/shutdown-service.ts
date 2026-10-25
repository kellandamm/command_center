import type { BoardStore } from "../board/store";
import { DONE } from "../board/types";
import type { CalendarWorkspace } from "../calendar/workspace";
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
const MAX_CLIENT_REVIEW_BYTES = 24_000;

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
    blockedToday: Array<{ title: string }>;
  };
  time: { calendarHours: number; blockedTaskHours: number };
  tomorrowPreview: {
    events: Array<{ summary: string; start: string; allDay: boolean }>;
    tasksDue: TodoistTask[];
  };
  llmEnabled: boolean;
  errors: {
    todoistCompleted?: string;
    todoistOpen?: string;
    calendar?: string;
  };
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

function durationMsOnDay(
  spec: { start: Date | string; end: Date | string | null; allDay: boolean; timezone?: string },
  day: string,
  tz: string,
): number {
  if (!spec.end) return 0;
  const dayStart = slotInstant(day, "00:00", tz).getTime();
  const dayEnd = slotInstant(nextDayKey(day), "00:00", tz).getTime();
  const zone = spec.timezone ?? tz;
  let startMs: number;
  let endMs: number;
  if (spec.allDay) {
    const startDay = typeof spec.start === "string" ? spec.start.slice(0, 10) : spec.start.toISOString().slice(0, 10);
    const endDay = typeof spec.end === "string" ? spec.end.slice(0, 10) : spec.end.toISOString().slice(0, 10);
    startMs = slotInstant(startDay, "00:00", zone).getTime();
    endMs = slotInstant(endDay, "00:00", zone).getTime();
  } else {
    startMs = typeof spec.start === "string" ? Date.parse(spec.start) : spec.start.getTime();
    endMs = typeof spec.end === "string" ? Date.parse(spec.end) : spec.end.getTime();
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.min(endMs, dayEnd) - Math.max(startMs, dayStart));
}

export function parseClientShutdownReview(body: unknown): ShutdownReview | null {
  if (!body || typeof body !== "object") return null;
  const review = (body as { review?: unknown }).review;
  if (!review || typeof review !== "object") return null;
  if (Buffer.byteLength(JSON.stringify(review), "utf8") > MAX_CLIENT_REVIEW_BYTES) return null;
  const r = review as ShutdownReview;
  if (r.zone !== SHUTDOWN_TZ || !/^\d{4}-\d{2}-\d{2}$/.test(r.day) || !/^\d{4}-\d{2}-\d{2}$/.test(r.tomorrow)) return null;
  if (!r.done || !r.unfinished || !r.time || !r.tomorrowPreview) return null;
  return { ...r, errors: r.errors ?? {} };
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
  const errors: ShutdownReview["errors"] = {};

  const doneBoard = opts.board
    .movesSince(since)
    .filter((m) => m.toCol === DONE && dayKeyFromIso(m.at, SHUTDOWN_TZ) === day)
    .map((m) => ({ cardId: m.cardId, title: m.title, at: m.at }));

  let doneTodoist: TodoistCompletedTask[] = [];
  let openTasks: TodoistTask[] = [];
  if (todoistConfigured(opts.cfg)) {
    const token = opts.cfg.todoistApiToken!;
    const range = dayRangeIso(day, SHUTDOWN_TZ);
    const listCompleted = opts.listCompleted ?? listCompletedTasks;
    try {
      doneTodoist = await listCompleted(token, range.since, range.until, fetchFn);
    } catch {
      errors.todoistCompleted = "Couldn't load Todoist completed tasks.";
      doneTodoist = [];
    }
    try {
      openTasks = await listTasks(token, fetchFn);
    } catch {
      errors.todoistOpen = "Couldn't load Todoist open tasks.";
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
    const ms = durationMsOnDay(block, day, SHUTDOWN_TZ);
    if (ms <= 0) continue;
    const card = cardsById.get(block.taskId);
    if (!card || card.column === DONE) continue;
    blockedToday.push({ title: card.title });
    blockedMs += ms;
  }

  let calendarMs = 0;
  let tomorrowEvents: ShutdownReview["tomorrowPreview"]["events"] = [];
  if (opts.calendar) {
    try {
      const rangeStart = slotInstant(day, "00:00", SHUTDOWN_TZ);
      const rangeEnd = slotInstant(nextDayKey(tomorrow), "00:00", SHUTDOWN_TZ);
      const snap = await opts.calendar.snapshot({ rangeStart, rangeEnd, limit: 500 });
      for (const ev of snap.events) {
        calendarMs += durationMsOnDay(
          { start: ev.start, end: ev.end, allDay: ev.allDay, timezone: SHUTDOWN_TZ },
          day,
          SHUTDOWN_TZ,
        );
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
    } catch {
      errors.calendar = "Couldn't load calendar.";
    }
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
    errors,
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
