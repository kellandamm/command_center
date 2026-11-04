import type { BoardStore } from "../board/store";
import { DONE } from "../board/types";
import type { CalendarWorkspace } from "../calendar/workspace";
import { todoistConfigured, type Config } from "../config";
import type { HobieQueueStore } from "../stores/hobie-queue";
import { ValidationError } from "../settings";
import type { WinsStore } from "../wins/store";
import { completeTask, reopenTask } from "../todoist/client";
import type { FetchLike } from "../llm/provider";
import { enrichStoredPlanForRead } from "./service";
import { gatherDayPlanContext } from "./gather";
import { DayPlanStore } from "./store";
import type { DayPlanSnapshot } from "./types";
import { DayPlanNotFoundError } from "./validate";

export const DAY_PLAN_UI_HEADER = "x-day-plan-ui";

export class MustDoRemoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function completeRemote(opts: {
  cfg: Config;
  board: BoardStore;
  hobieQueue: HobieQueueStore;
  wins: WinsStore;
  source: "board" | "todoist";
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
  source: "board" | "todoist";
  refId: string;
  fetchFn?: FetchLike;
}): Promise<void> {
  if (opts.source === "board") {
    const card = opts.board.get(opts.refId);
    if (!card) throw new MustDoRemoteError("Linked board card is unavailable.", 409);
    if (card.column !== DONE) return;
    const moved = await opts.board.move(opts.refId, "Backlog", {
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
  const plan = opts.store.load(opts.day);
  if (!plan) throw new DayPlanNotFoundError();
  const must = plan.mustDos.find((m) => m.slot === opts.slot);
  if (!must) throw new ValidationError("Invalid must-do slot.");

  if (must.completedAt) {
    return enrichAfterPatch(opts, plan);
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

  const completedAt = opts.now.toISOString();
  const patched = opts.store.patchMustDoCompletion(opts.day, opts.slot, completedAt);
  if (!patched) throw new DayPlanNotFoundError();
  return enrichAfterPatch(opts, patched);
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
  const plan = opts.store.load(opts.day);
  if (!plan) throw new DayPlanNotFoundError();
  const must = plan.mustDos.find((m) => m.slot === opts.slot);
  if (!must) throw new ValidationError("Invalid must-do slot.");

  if (!must.completedAt) {
    return enrichAfterPatch(opts, plan);
  }

  await reopenRemote({
    cfg: opts.cfg,
    board: opts.board,
    hobieQueue: opts.hobieQueue,
    wins: opts.wins,
    source: must.source,
    refId: must.refId,
    fetchFn: opts.fetchFn,
  });

  const patched = opts.store.patchMustDoCompletion(opts.day, opts.slot, null);
  if (!patched) throw new DayPlanNotFoundError();
  return enrichAfterPatch(opts, patched);
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
