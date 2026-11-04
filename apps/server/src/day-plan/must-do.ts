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
import { inflight, testHooks } from "./must-do-limits";
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

/** Plan row changed during remote sync; remote may already reflect completion. */
export class MustDoSlotChangedError extends MustDoRemoteError {
  readonly mustDoSyncConflict = true;
  constructor() {
    super(
      "This must-do changed while syncing. The task may already be completed in Todoist or Board. Reopen it here if needed.",
      409,
    );
  }
}

export class MustDoInFlightError extends Error {
  readonly status = 409;
  constructor() {
    super("Must-do action already in progress.");
  }
}

function inflightKey(day: string, slot: number): string {
  return `${day}:${slot}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function boardMoveDelayMs(): number | null {
  if (process.env.ALLOW_DAY_PLAN_TEST_HOOKS !== "1") return null;
  return testHooks.boardMoveDelayMs;
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
    const delay = boardMoveDelayMs();
    if (delay) await sleep(delay);
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
  expected: { source: TaskSource; refId: string },
): void {
  const must = store.load(day)?.mustDos.find((m) => m.slot === slot);
  if (!must || must.source !== expected.source || must.refId !== expected.refId) {
    throw new MustDoSlotChangedError();
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

    const expected = { source: must.source, refId: must.refId };
    let boardReopenColumn: string | null = null;
    if (must.source === "board") {
      const card = opts.board.get(must.refId);
      if (card && card.column !== DONE) boardReopenColumn = card.column;
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

    assertSlotStillMatches(opts.store, opts.day, opts.slot, expected);

    const completedAt = opts.now.toISOString();
    const patched = opts.store.patchMustDoCompletion(opts.day, opts.slot, {
      completedAt,
      boardReopenColumn: must.source === "board" ? boardReopenColumn : undefined,
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

    if (!must.completedAt) {
      return enrichAfterPatch(opts, plan);
    }

    const expected = { source: must.source, refId: must.refId };
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

    assertSlotStillMatches(opts.store, opts.day, opts.slot, expected);

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
