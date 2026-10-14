import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readJson, writeFileAtomic } from "../store";

export type HobieTaskStatus = "pending" | "claimed" | "done";

export interface HobieTask {
  id: string;
  clientId: string;
  title: string;
  body: string;
  urgent: boolean;
  status: HobieTaskStatus;
  createdAt: string;
  claimedAt?: string;
}

const MAX_TASKS = 100;
const MAX_TITLE = 200;
const MAX_BODY = 8_000;

export class HobieQueueStore {
  private tasks: HobieTask[] = [];
  private queue: Promise<void> = Promise.resolve();

  private constructor(private path: string) {}

  static async open(dataDir: string): Promise<HobieQueueStore> {
    const store = new HobieQueueStore(join(dataDir, "hobie-queue.json"));
    const saved = await readJson<HobieTask[]>(store.path);
    if (Array.isArray(saved)) store.tasks = saved;
    return store;
  }

  list(opts: { status?: HobieTaskStatus } = {}): HobieTask[] {
    let rows = [...this.tasks];
    if (opts.status) rows = rows.filter((t) => t.status === opts.status);
    rows.sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
    return rows;
  }

  pendingCount(): number {
    return this.tasks.filter((t) => t.status === "pending").length;
  }

  async enqueue(opts: { clientId: string; title: string; body: string; urgent: boolean }, maxPending: number): Promise<HobieTask> {
    const pending = this.pendingCount();
    if (pending >= maxPending) throw new Error(`Hobie queue full (${maxPending} pending tasks)`);
    const title = String(opts.title ?? "").trim().slice(0, MAX_TITLE);
    if (!title) throw new Error("title is required");
    let body = String(opts.body ?? "").trim();
    if (body.length > MAX_BODY) body = body.slice(0, MAX_BODY);
    const task: HobieTask = {
      id: randomUUID(),
      clientId: opts.clientId,
      title,
      body,
      urgent: Boolean(opts.urgent),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.tasks.push(task);
    if (this.tasks.length > MAX_TASKS) this.tasks = this.tasks.slice(-MAX_TASKS);
    await this.flush();
    return task;
  }

  async claim(id: string): Promise<HobieTask | undefined> {
    const task = this.tasks.find((t) => t.id === id && t.status === "pending");
    if (!task) return undefined;
    task.status = "claimed";
    task.claimedAt = new Date().toISOString();
    await this.flush();
    return task;
  }

  private flush(): Promise<void> {
    const run = this.queue.then(() => writeFileAtomic(this.path, JSON.stringify(this.tasks, null, 2)));
    this.queue = run.catch(() => {});
    return run;
  }
}
