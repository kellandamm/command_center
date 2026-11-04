import type { BoardStore } from "../board/store";
import { BOARD_COLUMNS, DONE, type BoardColumn } from "../board/types";
import type { CalendarWorkspace } from "../calendar/workspace";
import { todoistConfigured, type Config } from "../config";
import type { HobieQueueStore } from "../stores/hobie-queue";
import { ValidationError } from "../settings";
import type { WinsStore } from "../wins/store";
import { completeTask, reopenTask } from "../todoist/client";
import type { FetchLike } from "../llm/provider";
import { enrichStoredPlanForRead } from "./service";
import { gatherDayPlanContext } from "./gather";
import { inflight } from "./must-do-inflight";
import {
  forgetMustDoSyncConflictReopen,
  matchMustDoSyncConflictReopen,
  rememberMustDoSyncConflict,
} from "./must-do-sync-conflict";
import type { DayPlanStore } from "./store";
import type { DayPlanSnapshot, TaskSource } from "./types";
import { DayPlanNotFoundError } from "./validate";

/**
 * Defense-in-depth CSRF-style marker from the day-plan page script.
 * Not proof of a human click — the real gate is CF-verified owner (`isDayPlanOwner`).
 */
export const DAY_PLAN_UI_HEADER = "x-day-plan-ui";

export class MustDoRemoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface MustDoConflictRemoteTask {
  source: TaskSource;
  refId: string;
  boardReopenColumn?: string | null;
}

/** Plan row changed during remote sync; remote may already reflect completion. */
export class MustDoSlotChangedError extends MustDoRemoteError {
  readonly mustDoSyncConflict = true;
  readonly remoteTask: MustDoConflictRemoteTask;
  constructor(remoteTask: MustDoConflictRemoteTask) {
    super(
      "This must-do changed while syncing. The task may already be completed in Todoist or Board. Reopen it here if needed.",
      409,
    );
    this.remoteTask = remoteTask;
  }
}

export class MustDoInFlightError extends Error {
  readonly status = 409;
  constructor() {
    super("Must-do action already in progress.");
  }
}

/** No server-recorded sync conflict matches this reopen request. */
export class MustDoConflictReopenError extends MustDoRemoteError {
  constructor(
    message = "No active sync conflict to reopen. Reopen the task in Todoist or Board.",
  ) {
    super(message, 409);
  }
}

function inflightKey(day: string, slot: number): string {
  return `${day}:${slot}`;
}

function boardColumnOrBacklog(value: string | null | undefined): BoardColumn {
  if (value && (BOARD_COLUMNS as readonly string[]).includes(value)) return value as BoardColumn;
  return "Backlog";
}

async function completeRemote(opts: {
  cfg: Config;
  board: BoardStore;
  hobieQueue: HobieQueueStore;
  wins: WinsStore;
  source: TaskSource;
  refId: string;
  fetchFn?: FetchLike;
}): Promise<void> {
  if (opts.source === "board") {
    const card = opts.board.get(opts.refId);
    if (!card) throw new MustDoRemoteError("Linked board card is unavailable.", 409);
    if (card.column === DONE) return;
    const moved = await opts.board.move(opts.refId, DONE, {
      hobieQueue: opts.hobieQueue,
      maxHobiePending: opts.cfg.mcpMaxHobiePending,
      wins: opts.wins,
    });
    if (!moved) throw new MustDoRemoteError("Could not complete linked board card.", 502);
    return;
  }
  if (!todoistConfigured(opts.cfg)) throw new MustDoRemoteError("Todoist is not configured.", 409);
  try {
    await completeTask(opts.cfg.todoistApiToken!, opts.refId, opts.fetchFn ?? fetch);
  } catch {
    throw new MustDoRemoteError("Could not complete linked Todoist task.", 502);
  }
}

async function reopenRemote(opts: {
  cfg: Config;
  board: BoardStore;
  hobieQueue: HobieQueueStore;
  wins: WinsStore;
  source: TaskSource;
  refId: string;
  boardReopenColumn?: string | null;
  fetchFn?: FetchLike;
}): Promise<void> {
  if (opts.source === "board") {
    const card = opts.board.get(opts.refId);
    if (!card) throw new MustDoRemoteError("Linked board card is unavailable.", 409);
    if (card.column !== DONE) return;
    const target = boardColumnOrBacklog(opts.boardReopenColumn);
    const moved = await opts.board.move(opts.refId, target, {
      hobieQueue: opts.hobieQueue,
      maxHobiePending: opts.cfg.mcpMaxHobiePending,
      wins: opts.wins,
    });
    if (!moved) throw new MustDoRemoteError("Could not reopen linked board card.", 502);
    return;
  }
  if (!todoistConfigured(opts.cfg)) throw new MustDoRemoteError("Todoist is not configured.", 409);
  try {
    await reopenTask(opts.cfg.todoistApiToken!, opts.refId, opts.fetchFn ?? fetch);
  } catch {
    throw new MustDoRemoteError("Could not reopen linked Todoist task.", 502);
  }
}

function assertSlotStillMatches(
  store: DayPlanStore,
  day: string,
  slot: number,
  expected: MustDoConflictRemoteTask,
  now: Date,
): void {
  const must = store.load(day)?.mustDos.find((m) => m.slot === slot);
  if (!must || must.source !== expected.source || must.refId !== expected.refId) {
    rememberMustDoSyncConflict(day, slot, expected, now.getTime());
    throw new MustDoSlotChangedError(expected);
  }
}

export async function completeMustDoOnOwnerClick(opts: {
  cfg: Config;
  board: BoardStore;
  hobieQueue: HobieQueueStore;
  wins: WinsStore;
  calendar?: CalendarWorkspace;
  store: DayPlanStore;
  now: Date;
  day: string;
  slot: number;
  fetchFn?: FetchLike;
}): Promise<DayPlanSnapshot> {
  const key = inflightKey(opts.day, opts.slot);
  if (inflight.has(key)) throw new MustDoInFlightError();
  inflight.add(key);
  try {
    const plan = opts.store.load(opts.day);
    if (!plan) throw new DayPlanNotFoundError();
    const must = plan.mustDos.find((m) => m.slot === opts.slot);
    if (!must) throw new ValidationError("Invalid must-do slot.");

    if (must.completedAt) {
      return enrichAfterPatch(opts, plan);
    }

    const expected: MustDoConflictRemoteTask = { source: must.source, refId: must.refId };
    if (must.source === "board") {
      const card = opts.board.get(must.refId);
      if (card && card.column !== DONE) expected.boardReopenColumn = card.column;
    }

    await completeRemote({
      cfg: opts.cfg,
      board: opts.board,
      hobieQueue: opts.hobieQueue,
      wins: opts.wins,
      source: must.source,
      refId: must.refId,
      fetchFn: opts.fetchFn,
    });

    assertSlotStillMatches(opts.store, opts.day, opts.slot, expected, opts.now);

    const completedAt = opts.now.toISOString();
    const patched = opts.store.patchMustDoCompletion(opts.day, opts.slot, {
      completedAt,
      boardReopenColumn: must.source === "board" ? (expected.boardReopenColumn ?? null) : undefined,
    });
    if (!patched) throw new DayPlanNotFoundError();
    return enrichAfterPatch(opts, patched);
  } finally {
    inflight.delete(key);
  }
}

export async function reopenMustDoOnOwnerClick(opts: {
  cfg: Config;
  board: BoardStore;
  hobieQueue: HobieQueueStore;
  wins: WinsStore;
  calendar?: CalendarWorkspace;
  store: DayPlanStore;
  now: Date;
  day: string;
  slot: number;
  remoteTask?: MustDoConflictRemoteTask;
  fetchFn?: FetchLike;
}): Promise<DayPlanSnapshot> {
  const key = inflightKey(opts.day, opts.slot);
  if (inflight.has(key)) throw new MustDoInFlightError();
  inflight.add(key);
  try {
    const plan = opts.store.load(opts.day);
    if (!plan) throw new DayPlanNotFoundError();
    const must = plan.mustDos.find((m) => m.slot === opts.slot);
    if (!must) throw new ValidationError("Invalid must-do slot.");

    if (opts.remoteTask) {
      const stored = matchMustDoSyncConflictReopen(
        opts.day,
        opts.slot,
        { source: opts.remoteTask.source, refId: opts.remoteTask.refId },
        opts.now.getTime(),
      );
      if (!stored) throw new MustDoConflictReopenError();
      await reopenRemote({
        cfg: opts.cfg,
        board: opts.board,
        hobieQueue: opts.hobieQueue,
        wins: opts.wins,
        source: stored.source,
        refId: stored.refId,
        boardReopenColumn: stored.boardReopenColumn,
        fetchFn: opts.fetchFn,
      });
      forgetMustDoSyncConflictReopen(opts.day, opts.slot);
      return enrichAfterPatch(opts, plan);
    }

    if (!must.completedAt) {
      return enrichAfterPatch(opts, plan);
    }

    const expected: MustDoConflictRemoteTask = { source: must.source, refId: must.refId };
    const boardReopenColumn = must.boardReopenColumn;

    await reopenRemote({
      cfg: opts.cfg,
      board: opts.board,
      hobieQueue: opts.hobieQueue,
      wins: opts.wins,
      source: must.source,
      refId: must.refId,
      boardReopenColumn,
      fetchFn: opts.fetchFn,
    });

    assertSlotStillMatches(opts.store, opts.day, opts.slot, expected, opts.now);

    const patched = opts.store.patchMustDoCompletion(opts.day, opts.slot, {
      completedAt: null,
      boardReopenColumn: null,
    });
    if (!patched) throw new DayPlanNotFoundError();
    return enrichAfterPatch(opts, patched);
  } finally {
    inflight.delete(key);
  }
}

async function enrichAfterPatch(
  opts: {
    cfg: Config;
    board: BoardStore;
    calendar?: CalendarWorkspace;
    store: DayPlanStore;
    now: Date;
    day: string;
  },
  plan: DayPlanSnapshot,
): Promise<DayPlanSnapshot> {
  const context = await gatherDayPlanContext({
    cfg: opts.cfg,
    board: opts.board,
    calendar: opts.calendar,
    now: opts.now,
    day: opts.day,
  });
  return enrichStoredPlanForRead(plan, context, opts.store, opts.day);
}
