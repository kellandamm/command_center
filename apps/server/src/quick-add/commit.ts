import type { Config } from "../config";
import { todoistConfigured } from "../config";
import type { CalendarWorkspace } from "../calendar/workspace";
import { ValidationError } from "../settings";
import { createTask, type TodoistFetch } from "../todoist/client";
import { QUICK_ADD_TZ } from "./constants";
import { eventPayloadFromItem, normalizeQuickAddItem, taskDueForTodoist } from "./normalize";
import type { QuickAddCommitItem, QuickAddCommitResult } from "./types";

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

export async function commitQuickAddItems(
  cfg: Config,
  calendar: CalendarWorkspace | undefined,
  rawItems: unknown[],
  options: { calendarId?: string; fetchFn?: TodoistFetch } = {},
): Promise<QuickAddCommitResult[]> {
  if (!rawItems.length) throw new ValidationError("Add at least one item");
  const items = rawItems.map((item) => {
    const normalized = normalizeQuickAddItem(item);
    const calendarId = typeof (item as Record<string, unknown>)?.calendarId === "string"
      ? String((item as Record<string, unknown>).calendarId)
      : options.calendarId;
    return { ...normalized, calendarId } satisfies QuickAddCommitItem;
  });
  const results: QuickAddCommitResult[] = [];
  for (const item of items) {
    if (item.kind === "task") {
      if (!todoistConfigured(cfg)) throw new ValidationError("Todoist is not configured on the server");
      const due = taskDueForTodoist(item.due);
      const task = await createTask(cfg.todoistApiToken!, {
        content: item.title,
        description: item.notes,
        ...due,
      }, options.fetchFn);
      results.push({ kind: "task", title: task.content, url: task.url, id: task.id });
      continue;
    }
    if (!calendar) throw new ValidationError("Calendar is not available on the server");
    const calendarId = resolveCalendarId(calendar, item.calendarId);
    const payload = eventPayloadFromItem(item, calendarId, QUICK_ADD_TZ);
    const saved = await calendar.saveEvent(payload);
    const eventId = (saved as { id?: string }).id;
    if (!eventId) throw new ValidationError("Calendar did not return an event id");
    const url = `/calendar/events/${encodeURIComponent(eventId)}`;
    results.push({ kind: "event", title: String((saved as { summary?: string }).summary ?? item.title), url, id: eventId });
  }
  return results;
}
