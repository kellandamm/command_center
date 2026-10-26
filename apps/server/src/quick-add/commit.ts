import type { Config } from "../config";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { BoardStore } from "../board/store";
import { readJson, writeFileAtomic } from "../store";
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
  board?: BoardStore,
): Promise<QuickAddCommitResult> {
  if (item.kind === "task") {
    if (item.source === "board") {
      if (!board) throw new ValidationError("Native Board tasks are unavailable");
      const card = board.create({ title: item.title, notes: item.notes, dueDate: item.due ?? null });
      return { kind: "task", source: "board", title: card.title, url: `/calendar/event?task=${encodeURIComponent(card.id)}`, id: card.id };
    }
    if (!todoistConfigured(cfg)) throw new ValidationError(QUICK_ADD_TODOIST_NOT_CONFIGURED);
    const due = taskDueForTodoist(item.due, item.timezone ?? QUICK_ADD_TZ);
    const task = await createTask(cfg.todoistApiToken!, {
      content: item.title,
      description: item.notes,
      ...due,
    }, fetchFn);
    return { kind: "task", source: "todoist", title: task.content, url: task.url, id: task.id };
  }
  if (!calendar) throw new ValidationError("Calendar is not available on the server");
  const calendarId = resolveCalendarId(calendar, item.calendarId);
  const payload = eventPayloadFromItem(item, calendarId, item.timezone ?? QUICK_ADD_TZ);
  const saved = await calendar.saveEvent(payload);
  const eventId = (saved as { id?: string }).id;
  if (!eventId) throw new ValidationError("Calendar did not return an event id");
  const url = `/calendar/event?event=${encodeURIComponent(eventId)}`;
  return {
    kind: "event",
    source: calendarId.startsWith("google-") ? "google" : "native",
    title: String((saved as { summary?: string }).summary ?? item.title),
    url,
    id: eventId,
  };
}

const commitQueues = new Map<string, Promise<unknown>>();
interface Receipt { input: string; result?: QuickAddCommitResult }

export async function commitQuickAddItems(
  cfg: Config,
  calendar: CalendarWorkspace | undefined,
  rawItems: unknown[],
  options: { calendarId?: string; fetchFn?: TodoistFetch; board?: BoardStore } = {},
): Promise<{ results: QuickAddCommitResult[]; failures: QuickAddCommitFailure[] }> {
  const prior = commitQueues.get(cfg.dataDir) ?? Promise.resolve();
  const run = prior.catch(() => {}).then(() => commitItems(cfg, calendar, rawItems, options));
  commitQueues.set(cfg.dataDir, run);
  try { return await run; }
  finally { if (commitQueues.get(cfg.dataDir) === run) commitQueues.delete(cfg.dataDir); }
}

async function commitItems(
  cfg: Config,
  calendar: CalendarWorkspace | undefined,
  rawItems: unknown[],
  options: { calendarId?: string; fetchFn?: TodoistFetch; board?: BoardStore },
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
  const path = join(cfg.dataDir, "quick-add-receipts.json");
  const savedReceipts = await readJson<Record<string, Receipt>>(path);
  if (savedReceipts !== undefined && (!savedReceipts || typeof savedReceipts !== "object" || Array.isArray(savedReceipts)
    || Object.values(savedReceipts).some((receipt) => !receipt || typeof receipt.input !== "string"
      || (receipt.result && (typeof receipt.result.id !== "string" || typeof receipt.result.url !== "string"
        || typeof receipt.result.title !== "string" || !["task", "event"].includes(receipt.result.kind)))))) {
    throw new ValidationError("Invalid quick-add receipt journal. Restore a valid backup before confirming items.");
  }
  const receipts: Record<string, Receipt> = Object.assign(Object.create(null), savedReceipts ?? {});
  for (const { index, item } of items) {
    const key = item.operationId;
    let attempted = false;
    try {
      const input = createHash("sha256").update(JSON.stringify(item)).digest("hex");
      const receipt = key && Object.hasOwn(receipts, key) ? receipts[key] : undefined;
      if (receipt) {
        if (receipt.input !== input) throw new ValidationError("This preview item was already saved with different values. Parse a new item instead.");
        if (!receipt.result) throw new ValidationError("A previous save has an uncertain outcome. Inspect Board/calendar or the external provider before creating a new preview; this operation will not be repeated.");
        results.push(receipt.result);
        continue;
      }
      if (key) {
        receipts[key] = { input };
        await writeFileAtomic(path, JSON.stringify(receipts));
      }
      attempted = true;
      const result = await commitOne(cfg, calendar, item, options.fetchFn, options.board);
      if (key) {
        receipts[key] = { input, result };
        await writeFileAtomic(path, JSON.stringify(receipts));
      }
      results.push(result);
    } catch (err) {
      if (key && attempted && err instanceof ValidationError) {
        delete receipts[key];
        await writeFileAtomic(path, JSON.stringify(receipts));
      }
      failures.push({ index, title: item.title, error: commitItemError(err) });
    }
  }
  if (!results.length && failures.length) {
    throw new ValidationError(failures[0]!.error);
  }
  return { results, failures };
}
