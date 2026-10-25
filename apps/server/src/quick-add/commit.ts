import type { Config } from "../config";
import { todoistConfigured } from "../config";
import type { CalendarWorkspace } from "../calendar/workspace";
import { ValidationError } from "../settings";
import { createTask, type TodoistFetch } from "../todoist/client";
import { QUICK_ADD_TODOIST_NOT_CONFIGURED, commitItemError } from "./errors";
import {
  QUICK_ADD_TZ,
  eventPayloadFromItem,
  normalizeQuickAddItem,
  taskDueForTodoist,
  type QuickAddCommitFailure,
  type QuickAddCommitItem,
  type QuickAddCommitResult,
} from "./normalize";

function defaultNativeCalendarId(calendar: CalendarWorkspace): string {
  const native = calendar.store.list().find((row) => row.kind === "native" && row.enabled);
  if (!native) throw new ValidationError("Create a native calendar in Settings before adding events");
  return native.id;
}

function resolveCalendarId(calendar: CalendarWorkspace, id: string | undefined): string {
  const chosen = id?.trim();
  if (!chosen) return defaultNativeCalendarId(calendar);
  if (chosen.startsWith("google-")) {
    const google = calendar.google.status().selectedCalendars.find((row) => row.id === chosen);
    if (!google) throw new ValidationError("Choose a connected Google calendar");
    if (!google.writable) throw new ValidationError("That Google calendar is read-only");
    return chosen;
  }
  const native = calendar.store.get(chosen);
  if (!native || native.kind !== "native") throw new ValidationError("Choose a native calendar for local events");
  return chosen;
}

async function commitOne(
  cfg: Config,
  calendar: CalendarWorkspace | undefined,
  item: QuickAddCommitItem,
  fetchFn?: TodoistFetch,
): Promise<QuickAddCommitResult> {
  if (item.kind === "task") {
    if (!todoistConfigured(cfg)) throw new ValidationError(QUICK_ADD_TODOIST_NOT_CONFIGURED);
    const due = taskDueForTodoist(item.due);
    const task = await createTask(cfg.todoistApiToken!, {
      content: item.title,
      description: item.notes,
      ...due,
    }, fetchFn);
    return { kind: "task", title: task.content, url: task.url, id: task.id };
  }
  if (!calendar) throw new ValidationError("Calendar is not available on the server");
  const calendarId = resolveCalendarId(calendar, item.calendarId);
  const payload = eventPayloadFromItem(item, calendarId, QUICK_ADD_TZ);
  const saved = await calendar.saveEvent(payload);
  const eventId = (saved as { id?: string }).id;
  if (!eventId) throw new ValidationError("Calendar did not return an event id");
  const url = `/calendar/events/${encodeURIComponent(eventId)}`;
  return {
    kind: "event",
    title: String((saved as { summary?: string }).summary ?? item.title),
    url,
    id: eventId,
  };
}

export async function commitQuickAddItems(
  cfg: Config,
  calendar: CalendarWorkspace | undefined,
  rawItems: unknown[],
  options: { calendarId?: string; fetchFn?: TodoistFetch } = {},
): Promise<{ results: QuickAddCommitResult[]; failures: QuickAddCommitFailure[] }> {
  if (!rawItems.length) throw new ValidationError("Add at least one item");
  const items = rawItems.map((raw, index) => {
    const normalized = normalizeQuickAddItem(raw);
    const calendarId = typeof (raw as Record<string, unknown>)?.calendarId === "string"
      ? String((raw as Record<string, unknown>).calendarId)
      : options.calendarId;
    return { index, item: { ...normalized, calendarId } satisfies QuickAddCommitItem };
  });
  const results: QuickAddCommitResult[] = [];
  const failures: QuickAddCommitFailure[] = [];
  for (const { index, item } of items) {
    try {
      results.push(await commitOne(cfg, calendar, item, options.fetchFn));
    } catch (err) {
      failures.push({ index, title: item.title, error: commitItemError(err) });
    }
  }
  if (!results.length && failures.length) {
    throw new ValidationError(failures[0]!.error);
  }
  return { results, failures };
}
