import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readJson, writeFileAtomic } from "../store";

export interface PanelUpdate {
  id: string;
  clientId: string;
  panel: string;
  markdown: string;
  createdAt: string;
}

const MAX_ITEMS = 200;
const MAX_MARKDOWN = 4_000;

export class PanelUpdatesStore {
  private items: PanelUpdate[] = [];
  private queue: Promise<void> = Promise.resolve();

  private constructor(private path: string) {}

  static async open(dataDir: string): Promise<PanelUpdatesStore> {
    const store = new PanelUpdatesStore(join(dataDir, "panel-updates.json"));
    const saved = await readJson<PanelUpdate[]>(store.path);
    if (Array.isArray(saved)) store.items = saved;
    return store;
  }

  list(limit = 50): PanelUpdate[] {
    return [...this.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async append(opts: { clientId: string; panel: string; markdown: string }): Promise<PanelUpdate> {
    const panel = opts.panel.trim().slice(0, 64);
    if (!panel) throw new Error("panel is required");
    let markdown = String(opts.markdown ?? "").trim();
    if (!markdown) throw new Error("markdown is required");
    if (markdown.length > MAX_MARKDOWN) markdown = markdown.slice(0, MAX_MARKDOWN);
    const row: PanelUpdate = {
      id: randomUUID(),
      clientId: opts.clientId,
      panel,
      markdown,
      createdAt: new Date().toISOString(),
    };
    this.items.push(row);
    if (this.items.length > MAX_ITEMS) this.items = this.items.slice(-MAX_ITEMS);
    await this.flush();
    return row;
  }

  private flush(): Promise<void> {
    const run = this.queue.then(() => writeFileAtomic(this.path, JSON.stringify(this.items, null, 2)));
    this.queue = run.catch(() => {});
    return run;
  }
}
