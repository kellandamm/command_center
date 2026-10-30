import { todoistConfigured, type Config } from "../config";
import { listTasks, type TodoistFetch, type TodoistTask } from "../todoist/client";

export const TODOIST_OPEN_TASKS_TTL_MS = 60_000;

export class TodoistOpenTaskCache {
  private tasks: TodoistTask[] | null = null;
  private expiresAt = 0;
  private inflight: Promise<TodoistTask[]> | null = null;

  constructor(
    private cfg: Config,
    private fetchFn: TodoistFetch = fetch,
  ) {}

  async getOpenTasks(): Promise<TodoistTask[]> {
    if (!todoistConfigured(this.cfg)) return [];
    const token = this.cfg.todoistApiToken;
    if (!token) return [];
    const now = Date.now();
    if (this.tasks && this.expiresAt > now) return this.tasks;
    if (this.inflight) return this.inflight;
    this.inflight = listTasks(token, this.fetchFn)
      .then((tasks) => {
        this.tasks = tasks;
        this.expiresAt = Date.now() + TODOIST_OPEN_TASKS_TTL_MS;
        return tasks;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  resetForTests(): void {
    this.tasks = null;
    this.expiresAt = 0;
    this.inflight = null;
  }
}
