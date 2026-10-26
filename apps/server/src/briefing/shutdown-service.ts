import type { BoardStore } from "../board/store";
import { DONE } from "../board/types";
import type { CalendarWorkspace } from "../calendar/workspace";
import { calendarLocalInstant, validDay } from "../calendar/store";
import { ValidationError } from "../settings";
import type { Config } from "../config";
import { llmConfig, todoistConfigured } from "../config";
import { dayKeyFromIso } from "../heatmap/counts";
import { chatCompletion, type FetchLike } from "../llm/provider";
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
const MAX_CLIENT_REVIEW_BYTES = 64 * 1024;
const MAX_REFLECTION_ARRAY = 100;
const MAX_REFLECTION_STR = 300;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ShutdownReflectionSource {
  day: string;
  zone: string;
  doneTodoist: number;
  doneBoard: number;
  openCount: number;
  calendarHours: number;
  blockedHours: number;
  tomorrowEvents: number;
  tomorrowTasksDue: number;
}

export type CompletedTasksFetcher = (
  token: string,
  since: string,
  until: string,
  fetchFn?: FetchLike,
) => Promise<TodoistCompletedTask[]>;

export interface ShutdownReview {
  zone: string;
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
    blockedToday: Array<{ cardId: string; title: string; dueDate: string | null; scheduled: boolean }>;
  };
  time: { calendarHours: number; blockedTaskHours: number };
  tomorrowPreview: {
    events: Array<{ summary: string; start: string; allDay: boolean }>;
    tasksDue: TodoistTask[];
    nativeTasksDue: Array<{ cardId: string; title: string; dueDate: string | null }>;
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
  if (!validDay(day)) throw new ValidationError("Invalid review day");
  const since = calendarLocalInstant(day, "00:00", tz);
  const until = calendarLocalInstant(nextDayKey(day), "00:00", tz);
  if (!since || !until) throw new ValidationError("The selected day boundary does not exist in this timezone");
  return { since: since.toISOString(), until: until.toISOString() };
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
  const range = dayRangeIso(day, tz);
  const dayStart = Date.parse(range.since);
  const dayEnd = Date.parse(range.until);
  const zone = spec.timezone ?? tz;
  let startMs: number;
  let endMs: number;
  if (spec.allDay) {
    const startDay = typeof spec.start === "string" ? spec.start.slice(0, 10) : spec.start.toISOString().slice(0, 10);
    const endDay = typeof spec.end === "string" ? spec.end.slice(0, 10) : spec.end.toISOString().slice(0, 10);
    const start = calendarLocalInstant(startDay, "00:00", zone), end = calendarLocalInstant(endDay, "00:00", zone);
    if (!start || !end) throw new ValidationError("The selected all-day boundary does not exist in this timezone");
    startMs = start.getTime();
    endMs = end.getTime();
  } else {
    startMs = typeof spec.start === "string" ? Date.parse(spec.start) : spec.start.getTime();
    endMs = typeof spec.end === "string" ? Date.parse(spec.end) : spec.end.getTime();
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.min(endMs, dayEnd) - Math.max(startMs, dayStart));
}

function capReflectionStr(value: unknown): string | null {
  if (typeof value !== "string" || value.includes("\0")) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_REFLECTION_STR);
}

function validReflectionHours(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 24_000) return null;
  return value;
}

function parseReflectionArray(value: unknown, item: (row: unknown) => boolean): number | null {
  if (!Array.isArray(value) || value.length > MAX_REFLECTION_ARRAY) return null;
  for (const row of value) {
    if (!item(row)) return null;
  }
  return value.length;
}

function parseOpenTaskRow(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  return capReflectionStr((row as { content?: unknown }).content) !== null;
}

function parseDoneTodoistRow(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const o = row as { id?: unknown; content?: unknown; completedAt?: unknown };
  return capReflectionStr(o.id) !== null && capReflectionStr(o.content) !== null && capReflectionStr(o.completedAt) !== null;
}

function parseDoneBoardRow(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const o = row as { title?: unknown };
  return capReflectionStr(o.title) !== null;
}

function parseBlockedRow(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  return capReflectionStr((row as { title?: unknown }).title) !== null;
}

function parseTomorrowEventRow(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const o = row as { summary?: unknown; start?: unknown; allDay?: unknown };
  return capReflectionStr(o.summary) !== null && capReflectionStr(o.start) !== null && typeof o.allDay === "boolean";
}

/** Validates client POST body; returns counts-only source safe for the LLM prompt. */
export function parseClientShutdownReview(body: unknown, timezone: string = SHUTDOWN_TZ): ShutdownReflectionSource | null {
  if (!body || typeof body !== "object") return null;
  const review = (body as { review?: unknown }).review;
  if (!review || typeof review !== "object") return null;
  if (Buffer.byteLength(JSON.stringify(review), "utf8") > MAX_CLIENT_REVIEW_BYTES) return null;
  const r = review as Record<string, unknown>;
  if (r.zone !== timezone || !DAY_RE.test(String(r.day ?? "")) || !DAY_RE.test(String(r.tomorrow ?? ""))) return null;
  if (typeof r.generatedAt !== "string" || typeof r.todoistConfigured !== "boolean" || typeof r.llmEnabled !== "boolean") return null;
  const done = r.done;
  const unfinished = r.unfinished;
  const time = r.time;
  const tomorrowPreview = r.tomorrowPreview;
  if (!done || typeof done !== "object" || !unfinished || typeof unfinished !== "object") return null;
  if (!time || typeof time !== "object" || !tomorrowPreview || typeof tomorrowPreview !== "object") return null;
  const doneTodoist = parseReflectionArray((done as { todoist?: unknown }).todoist, parseDoneTodoistRow);
  const doneBoard = parseReflectionArray((done as { board?: unknown }).board, parseDoneBoardRow);
  if (doneTodoist === null || doneBoard === null) return null;
  const todoist = (unfinished as { todoist?: unknown }).todoist;
  if (!todoist || typeof todoist !== "object") return null;
  const overdue = parseReflectionArray((todoist as { overdue?: unknown }).overdue, parseOpenTaskRow);
  const today = parseReflectionArray((todoist as { today?: unknown }).today, parseOpenTaskRow);
  const blocked = parseReflectionArray((unfinished as { blockedToday?: unknown }).blockedToday, parseBlockedRow);
  if (overdue === null || today === null || blocked === null) return null;
  const calendarHours = validReflectionHours((time as { calendarHours?: unknown }).calendarHours);
  const blockedHours = validReflectionHours((time as { blockedTaskHours?: unknown }).blockedTaskHours);
  if (calendarHours === null || blockedHours === null) return null;
  const events = parseReflectionArray((tomorrowPreview as { events?: unknown }).events, parseTomorrowEventRow);
  const tasksDue = parseReflectionArray((tomorrowPreview as { tasksDue?: unknown }).tasksDue, parseOpenTaskRow);
  const nativeTasksDue = parseReflectionArray((tomorrowPreview as { nativeTasksDue?: unknown }).nativeTasksDue ?? [], parseDoneBoardRow);
  if (events === null || tasksDue === null || nativeTasksDue === null) return null;
  if (r.errors !== undefined && (typeof r.errors !== "object" || r.errors === null)) return null;
  return {
    day: String(r.day),
    zone: timezone,
    doneTodoist,
    doneBoard,
    openCount: overdue + today + blocked,
    calendarHours,
    blockedHours,
    tomorrowEvents: events,
    tomorrowTasksDue: tasksDue + nativeTasksDue,
  };
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
  const tz = opts.cfg.tz;
  const day = dayKey(opts.now, tz);
  const tomorrow = nextDayKey(day);
  const { since, until } = dayRangeIso(day, tz);
  const errors: ShutdownReview["errors"] = {};
  const cards = opts.board.list();
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const seenDone = new Set<string>();

  const doneBoard = opts.board
    .movesSince(since)
    .filter((m) => {
      if (m.toCol !== DONE || cardsById.get(m.cardId)?.column !== DONE || dayKeyFromIso(m.at, tz) !== day || seenDone.has(m.cardId)) return false;
      seenDone.add(m.cardId);
      return true;
    })
    .map((m) => ({ cardId: m.cardId, title: m.title, at: m.at }));

  let doneTodoist: TodoistCompletedTask[] = [];
  let openTasks: TodoistTask[] = [];
  if (todoistConfigured(opts.cfg)) {
    const token = opts.cfg.todoistApiToken!;
    const range = dayRangeIso(day, tz);
    const listCompleted = opts.listCompleted ?? listCompletedTasks;
    try {
      const completed = await listCompleted(token, range.since, range.until, fetchFn);
      doneTodoist = [...new Map(completed.filter((task) => Date.parse(task.completedAt) >= Date.parse(since) && Date.parse(task.completedAt) < Date.parse(until)).map((task) => [task.id, task])).values()];
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

  const { overdue, today } = partitionTodayAndOverdue(openTasks, opts.now, tz);

  const planned = new Map<string, ShutdownReview["unfinished"]["blockedToday"][number]>();
  for (const card of cards) {
    if (card.column !== DONE && card.dueDate && card.dueDate <= day) planned.set(card.id, { cardId: card.id, title: card.title, dueDate: card.dueDate, scheduled: false });
  }
  let blockedMs = 0;
  let calendarMs = 0;
  let tomorrowEvents: ShutdownReview["tomorrowPreview"]["events"] = [];
  if (opts.calendar) {
    try {
      const rangeStart = new Date(since);
      const rangeEnd = new Date(dayRangeIso(tomorrow, tz).until);
      const snap = await opts.calendar.snapshot({ rangeStart, rangeEnd, limit: 500 });
      const blocksById = new Map(opts.calendar.planning().blocks.map((block) => [block.id, block]));
      if (snap.truncated || snap.feeds.some((feed) => !feed.ok)) errors.calendar = "Calendar review is incomplete: a feed is unavailable or results are limited.";
      for (const ev of snap.events) {
        const block = ev.eventId ? blocksById.get(ev.eventId) : undefined;
        const ms = durationMsOnDay({ start: ev.start, end: ev.end, allDay: ev.allDay, timezone: ev.timezone ?? block?.timezone ?? tz }, day, tz);
        if (block?.taskId) {
          blockedMs += ms;
          const card = cardsById.get(block.taskId);
          if (ms > 0 && card && card.column !== DONE) planned.set(card.id, { cardId: card.id, title: card.title, dueDate: card.dueDate, scheduled: true });
        } else calendarMs += ms;
      }
      tomorrowEvents = snap.events
        .filter((ev) => {
          return durationMsOnDay({ start: ev.start, end: ev.end, allDay: ev.allDay, timezone: ev.timezone ?? (ev.eventId ? blocksById.get(ev.eventId)?.timezone : tz) }, tomorrow, tz) > 0
            || (!ev.end && dayKey(ev.start, tz) === tomorrow);
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
    .filter((t) => taskDueDay(t, tz) === tomorrow)
    .sort((a, b) => b.priority - a.priority || a.content.localeCompare(b.content));

  return {
    zone: tz,
    day,
    tomorrow,
    generatedAt: opts.now.toISOString(),
    todoistConfigured: todoistConfigured(opts.cfg),
    done: { todoist: doneTodoist, board: doneBoard },
    unfinished: { todoist: { overdue, today }, blockedToday: [...planned.values()] },
    time: { calendarHours: hoursFromMs(calendarMs), blockedTaskHours: hoursFromMs(blockedMs) },
    tomorrowPreview: { events: tomorrowEvents, tasksDue: tasksDueTomorrow, nativeTasksDue: cards.filter((card) => card.column !== DONE && card.dueDate === tomorrow).map((card) => ({ cardId: card.id, title: card.title, dueDate: card.dueDate })) },
    llmEnabled: Boolean(llmConfig(opts.cfg)),
    errors,
  };
}

export async function generateShutdownReflection(
  source: ShutdownReflectionSource,
  cfg: Config,
  fetchFn: FetchLike = fetch,
): Promise<string | null> {
  const llm = llmConfig(cfg);
  if (!llm) return null;
  const doneCount = source.doneTodoist + source.doneBoard;
  const prompt = [
    `Shutdown review for ${source.day} (${source.zone}).`,
    `Completed: ${doneCount} items (${source.doneTodoist} Todoist, ${source.doneBoard} board).`,
    `Still open from today's plan: ${source.openCount}.`,
    `Calendar ${source.calendarHours}h vs blocked tasks ${source.blockedHours}h.`,
    `Tomorrow: ${source.tomorrowEvents} early events, ${source.tomorrowTasksDue} tasks due.`,
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
