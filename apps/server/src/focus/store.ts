import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ValidationError } from "../settings";
import { readJson, writeFileAtomic } from "../store";

export const MAX_FOCUS_DURATION_MS = 8 * 60 * 60 * 1000;
export const MIN_FOCUS_DURATION_MS = 1_000;
const MAX_STORED_SESSIONS = 5_000;
const MAX_TASK_ID_LEN = 80;
const MAX_TASK_TITLE_LEN = 500;

const sessionSchema = z.object({
  id: z.string().min(1).max(80),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1),
  durationMs: z.number().int().positive(),
  taskId: z.string().min(1).max(MAX_TASK_ID_LEN),
  taskTitle: z.string().max(MAX_TASK_TITLE_LEN).optional(),
});

const fileSchema = z.object({
  sessions: z.array(sessionSchema).max(MAX_STORED_SESSIONS),
});

export type FocusSession = z.infer<typeof sessionSchema>;

function parseIso(field: string, value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new ValidationError(`${field} must be an ISO timestamp`);
  }
  return value;
}

export function validateFocusSessionInput(input: Record<string, unknown>): Omit<FocusSession, "id"> {
  const startedAt = parseIso("startedAt", input.startedAt);
  const endedAt = parseIso("endedAt", input.endedAt);
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);
  if (endMs <= startMs) throw new ValidationError("endedAt must be after startedAt");
  const durationMs = endMs - startMs;
  if (durationMs < MIN_FOCUS_DURATION_MS) throw new ValidationError(`focus session must be at least ${MIN_FOCUS_DURATION_MS}ms`);
  if (durationMs > MAX_FOCUS_DURATION_MS) throw new ValidationError(`focus session cannot exceed ${MAX_FOCUS_DURATION_MS}ms`);
  if (input.durationMs !== undefined) {
    const claimed = input.durationMs;
    if (typeof claimed !== "number" || !Number.isInteger(claimed) || claimed !== durationMs) {
      throw new ValidationError("durationMs must match startedAt and endedAt");
    }
  }
  const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
  if (!taskId || taskId.length > MAX_TASK_ID_LEN) throw new ValidationError("taskId is required");
  let taskTitle: string | undefined;
  if (input.taskTitle !== undefined && input.taskTitle !== null && input.taskTitle !== "") {
    if (typeof input.taskTitle !== "string") throw new ValidationError("taskTitle must be text");
    taskTitle = input.taskTitle.trim().slice(0, MAX_TASK_TITLE_LEN) || undefined;
  }
  return { startedAt, endedAt, durationMs, taskId, taskTitle };
}

function parseFile(raw: unknown): { sessions: FocusSession[] } {
  if (raw === undefined || raw === null) return { sessions: [] };
  const result = fileSchema.safeParse(raw);
  if (!result.success) return { sessions: [] };
  return result.data;
}

export class FocusSessionsStore {
  private queue: Promise<void> = Promise.resolve();
  private sessions: FocusSession[];

  private constructor(private path: string, sessions: FocusSession[]) {
    this.sessions = sessions;
  }

  static async open(dataDir: string): Promise<FocusSessionsStore> {
    const path = join(dataDir, "focus-sessions.json");
    let raw: unknown;
    try {
      raw = await readJson<unknown>(path);
    } catch {
      raw = undefined;
    }
    return new FocusSessionsStore(path, parseFile(raw).sessions);
  }

  list(limit = 50): FocusSession[] {
    return structuredClone(this.sessions.slice(-limit).reverse());
  }

  endedAtSince(sinceIso: string): string[] {
    const since = Date.parse(sinceIso);
    return this.sessions.filter((s) => Date.parse(s.endedAt) >= since).map((s) => s.endedAt);
  }

  private async persist(): Promise<void> {
    await writeFileAtomic(this.path, JSON.stringify({ sessions: this.sessions }, null, 2));
  }

  private async mutate<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const result = await fn();
      await this.persist();
      return result;
    });
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  async append(input: Omit<FocusSession, "id">): Promise<FocusSession> {
    const parsed = validateFocusSessionInput(input as Record<string, unknown>);
    return this.mutate(() => {
      const session: FocusSession = { id: randomUUID(), ...parsed };
      this.sessions.push(session);
      if (this.sessions.length > MAX_STORED_SESSIONS) {
        this.sessions = this.sessions.slice(-MAX_STORED_SESSIONS);
      }
      return structuredClone(session);
    });
  }
}
