import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ValidationError } from "../settings";
import { readJson, writeFileAtomic } from "../store";
import { sanitizeWhiteboardScene, type SanitizedWhiteboardScene } from "./sanitize";

const sceneRecordSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(160),
  scene: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const fileSchema = z.object({
  scenes: z.array(sceneRecordSchema).max(200),
});

export type WhiteboardSceneRecord = z.infer<typeof sceneRecordSchema> & { scene: SanitizedWhiteboardScene };

function parseFile(raw: unknown): { scenes: WhiteboardSceneRecord[] } {
  if (raw === undefined || raw === null) return { scenes: [] };
  const result = fileSchema.safeParse(raw);
  if (!result.success) return { scenes: [] };
  const scenes: WhiteboardSceneRecord[] = [];
  for (const row of result.data.scenes) {
    try {
      scenes.push({ ...row, scene: sanitizeWhiteboardScene(row.scene) });
    } catch {
      // skip corrupt rows on load
    }
  }
  return { scenes };
}

export class WhiteboardStore {
  private queue: Promise<void> = Promise.resolve();
  private scenes: WhiteboardSceneRecord[];

  private constructor(private path: string, scenes: WhiteboardSceneRecord[]) {
    this.scenes = scenes;
  }

  static async open(dataDir: string): Promise<WhiteboardStore> {
    const path = join(dataDir, "whiteboards.json");
    let raw: unknown;
    try {
      raw = await readJson<unknown>(path);
    } catch {
      raw = undefined;
    }
    return new WhiteboardStore(path, parseFile(raw).scenes);
  }

  list(): Array<Pick<WhiteboardSceneRecord, "id" | "title" | "createdAt" | "updatedAt">> {
    return this.scenes.map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }));
  }

  get(id: string): WhiteboardSceneRecord | undefined {
    return structuredClone(this.scenes.find((s) => s.id === id));
  }

  private async persist(): Promise<void> {
    await writeFileAtomic(this.path, JSON.stringify({ scenes: this.scenes }, null, 2));
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

  async create(input: { title?: string; scene?: unknown }): Promise<WhiteboardSceneRecord> {
    const title = (input.title ?? "Untitled board").trim();
    if (!title) throw new ValidationError("title is required");
    if (title.length > 160) throw new ValidationError("title exceeds 160 characters");
    const scene = sanitizeWhiteboardScene(
      input.scene ?? { type: "excalidraw", version: 2, elements: [], appState: {}, files: {} },
    );
    const now = new Date().toISOString();
    const record: WhiteboardSceneRecord = {
      id: randomUUID(),
      title,
      scene,
      createdAt: now,
      updatedAt: now,
    };
    return this.mutate(() => {
      this.scenes.push(record);
      return structuredClone(record);
    });
  }

  async save(id: string, input: { title?: string; scene: unknown }): Promise<WhiteboardSceneRecord | undefined> {
    const idx = this.scenes.findIndex((s) => s.id === id);
    if (idx < 0) return undefined;
    const scene = sanitizeWhiteboardScene(input.scene);
    const title = input.title !== undefined ? input.title.trim() : this.scenes[idx]!.title;
    if (!title) throw new ValidationError("title is required");
    if (title.length > 160) throw new ValidationError("title exceeds 160 characters");
    const updated: WhiteboardSceneRecord = {
      ...this.scenes[idx]!,
      title,
      scene,
      updatedAt: new Date().toISOString(),
    };
    return this.mutate(() => {
      this.scenes[idx] = updated;
      return structuredClone(updated);
    });
  }

  async remove(id: string): Promise<boolean> {
    const before = this.scenes.length;
    return this.mutate(() => {
      this.scenes = this.scenes.filter((s) => s.id !== id);
      return this.scenes.length < before;
    });
  }
}
