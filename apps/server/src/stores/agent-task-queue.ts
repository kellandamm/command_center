import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readJson, writeFileAtomic } from "../store";

export type AgentTaskStatus = "pending" | "leased" | "done" | "failed" | "approval_needed";

export interface AgentTaskResult {
  status: "done" | "failed" | "approval_needed";
  summary: string;
  evidence?: string;
  tokens_used?: number;
  recordedAt: string;
}

export interface AgentTask {
  id: string;
  text: string;
  missionId?: string;
  missionTitle?: string;
  status: AgentTaskStatus;
  createdAt: string;
  leaseUntil?: string;
  leasedAt?: string;
  result?: AgentTaskResult;
}

const MAX_TASKS = 500;
const MAX_TEXT = 16_000;
const MAX_MISSION_TASKS = 20;
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_RETAIN_DAYS = 14;

export class AgentTaskQueueStore {
  private tasks: AgentTask[] = [];
  private queue: Promise<void> = Promise.resolve();

  private constructor(private path: string) {}

  static async open(dataDir: string): Promise<AgentTaskQueueStore> {
    const store = new AgentTaskQueueStore(join(dataDir, "queue.json"));
    const saved = await readJson<AgentTask[]>(store.path);
    if (Array.isArray(saved)) store.tasks = saved;
    return store;
  }

  list(): AgentTask[] {
    return structuredClone(this.tasks);
  }

  get(id: string): AgentTask | undefined {
    const t = this.tasks.find((row) => row.id === id);
    return t ? structuredClone(t) : undefined;
  }

  async enqueue(text: string): Promise<AgentTask> {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) throw new Error("task text is required");
    const task: AgentTask = {
      id: randomUUID(),
      text: trimmed.slice(0, MAX_TEXT),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    return this.mutate(() => {
      this.tasks.push(task);
      this.prune();
      return structuredClone(task);
    });
  }

  async enqueueMission(title: string, taskTexts: string[]): Promise<AgentTask[]> {
    const missionTitle = String(title ?? "").trim();
    const cleanTasks = taskTexts.map((text) => String(text ?? "").trim()).filter(Boolean);
    if (!missionTitle) throw new Error("mission title is required");
    if (!cleanTasks.length) throw new Error("at least one task is required");
    if (cleanTasks.length > MAX_MISSION_TASKS) throw new Error(`a mission can include up to ${MAX_MISSION_TASKS} tasks`);
    if (missionTitle.length > 200) throw new Error("mission title must be 200 characters or fewer");
    if (cleanTasks.some((text) => text.length > MAX_TEXT)) throw new Error(`each task must be ${MAX_TEXT} characters or fewer`);

    const missionId = randomUUID();
    const createdAt = new Date().toISOString();
    const tasks: AgentTask[] = cleanTasks.map((text) => ({
      id: randomUUID(),
      missionId,
      missionTitle,
      text,
      status: "pending",
      createdAt,
    }));
    return this.mutate(() => {
      this.tasks.push(...tasks);
      this.prune();
      return structuredClone(tasks);
    });
  }

  /** Claim oldest pending task (or reclaim expired lease). */
  async claimNext(leaseMs = DEFAULT_LEASE_MS): Promise<AgentTask | null> {
    const now = Date.now();
    return this.mutate(() => {
      this.releaseExpiredLeases(now);
      const pending = this.tasks
        .filter((t) => t.status === "pending")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const task = pending[0];
      if (!task) return null;
      task.status = "leased";
      task.leasedAt = new Date(now).toISOString();
      task.leaseUntil = new Date(now + leaseMs).toISOString();
      return structuredClone(task);
    });
  }

  async recordResult(
    id: string,
    result: Omit<AgentTaskResult, "recordedAt">,
  ): Promise<AgentTask | undefined> {
    return this.mutate(() => {
      const task = this.tasks.find((t) => t.id === id);
      if (!task || task.status !== "leased") return undefined;
      task.result = { ...result, recordedAt: new Date().toISOString() };
      task.status = result.status;
      task.leaseUntil = undefined;
      this.prune();
      return structuredClone(task);
    });
  }

  private releaseExpiredLeases(nowMs: number): void {
    for (const task of this.tasks) {
      if (task.status !== "leased" || !task.leaseUntil) continue;
      if (Date.parse(task.leaseUntil) <= nowMs) {
        task.status = "pending";
        task.leaseUntil = undefined;
        task.leasedAt = undefined;
      }
    }
  }

  private prune(retainDays = DEFAULT_RETAIN_DAYS): void {
    const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
    this.tasks = this.tasks.filter((t) => {
      if (t.status !== "done" && t.status !== "failed") return true;
      const ended = t.result?.recordedAt ?? t.createdAt;
      return Date.parse(ended) >= cutoff;
    });
    if (this.tasks.length > MAX_TASKS) {
      this.tasks = this.tasks.slice(-MAX_TASKS);
    }
  }

  private async mutate<T>(change: () => T): Promise<T> {
    const run = this.queue.then(async () => {
      const result = change();
      await writeFileAtomic(this.path, JSON.stringify(this.tasks, null, 2));
      return result;
    });
    this.queue = run.then(() => {}, () => {});
    return run;
  }
}
