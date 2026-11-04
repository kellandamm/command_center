import type { TaskSource } from "./types";

const TTL_MS = 24 * 60 * 60 * 1000;

export type StoredMustDoConflictTask = {
  source: TaskSource;
  refId: string;
  boardReopenColumn?: string | null;
};

type Entry = { task: StoredMustDoConflictTask; expiresAt: number };

const conflicts = new Map<string, Entry>();

function key(day: string, slot: number): string {
  return `${day}:${slot}`;
}

export function rememberMustDoSyncConflict(
  day: string,
  slot: number,
  task: StoredMustDoConflictTask,
  nowMs: number = Date.now(),
): void {
  sweepExpiredConflicts(nowMs);
  conflicts.set(key(day, slot), {
    task: {
      source: task.source,
      refId: task.refId,
      boardReopenColumn: task.boardReopenColumn,
    },
    expiresAt: nowMs + TTL_MS,
  });
}

function sweepExpiredConflicts(nowMs: number): void {
  for (const [k, entry] of conflicts) {
    if (nowMs >= entry.expiresAt) conflicts.delete(k);
  }
}

/** Returns stored task when client source/refId match and entry is valid (record kept until forget). */
export function matchMustDoSyncConflictReopen(
  day: string,
  slot: number,
  client: { source: TaskSource; refId: string },
  nowMs: number = Date.now(),
): StoredMustDoConflictTask | null {
  const k = key(day, slot);
  const entry = conflicts.get(k);
  if (!entry) return null;
  if (nowMs >= entry.expiresAt) {
    conflicts.delete(k);
    return null;
  }
  if (entry.task.source !== client.source || entry.task.refId !== client.refId) return null;
  return entry.task;
}

export function forgetMustDoSyncConflictReopen(day: string, slot: number): void {
  conflicts.delete(key(day, slot));
}

export function clearMustDoSyncConflictsForTests(): void {
  conflicts.clear();
}

/** Forces the stored conflict for day:slot to be treated as expired on the next reopen attempt. */
export function expireMustDoSyncConflictForTests(day: string, slot: number): void {
  const k = key(day, slot);
  const entry = conflicts.get(k);
  if (!entry) return;
  entry.expiresAt = 0;
}
