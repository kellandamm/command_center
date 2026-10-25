import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ValidationError } from "../settings";
import { readJson, writeFileAtomic } from "../store";
import type { QuickAddItem } from "../quick-add/normalize";
import { VOICE_CAPTURE_TTL_MS } from "./limits";

const itemSchema = z.object({
  kind: z.enum(["task", "event"]),
  title: z.string(),
  due: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  durationMinutes: z.number().optional(),
  notes: z.string().optional(),
});

const captureSchema = z.object({
  id: z.string().min(8).max(40),
  createdAt: z.string(),
  expiresAt: z.string(),
  transcript: z.string(),
  items: z.array(itemSchema),
});

export type VoiceCaptureRecord = z.infer<typeof captureSchema>;

const fileSchema = z.object({
  captures: z.array(captureSchema).max(200),
});

function parseFile(raw: unknown): { captures: VoiceCaptureRecord[] } {
  if (raw === undefined || raw === null) return { captures: [] };
  const result = fileSchema.safeParse(raw);
  if (!result.success) throw new ValidationError("Invalid voice-captures.json");
  return result.data;
}

function newId(): string {
  return randomBytes(12).toString("hex");
}

export class VoiceCaptureStore {
  private queue: Promise<void> = Promise.resolve();
  private captures: VoiceCaptureRecord[];

  private constructor(private path: string, captures: VoiceCaptureRecord[]) {
    this.captures = captures;
  }

  static async open(dataDir: string): Promise<VoiceCaptureStore> {
    const path = join(dataDir, "voice-captures.json");
    let raw: unknown;
    try {
      raw = await readJson<unknown>(path);
    } catch {
      raw = undefined;
    }
    const store = new VoiceCaptureStore(path, parseFile(raw).captures);
    await store.purgeExpired();
    return store;
  }

  private async persist(): Promise<void> {
    await writeFileAtomic(this.path, JSON.stringify({ captures: this.captures }, null, 2));
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

  private active(now = Date.now()): VoiceCaptureRecord[] {
    return this.captures.filter((row) => Date.parse(row.expiresAt) > now);
  }

  async purgeExpired(): Promise<void> {
    await this.mutate(() => {
      const now = Date.now();
      this.captures = this.active(now);
    });
  }

  pendingCount(): number {
    return this.active().length;
  }

  listSummaries(): Array<{ id: string; createdAt: string; itemCount: number }> {
    return this.active()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((row) => ({ id: row.id, createdAt: row.createdAt, itemCount: row.items.length }));
  }

  get(id: string): VoiceCaptureRecord | undefined {
    const row = this.active().find((c) => c.id === id);
    return row ? structuredClone(row) : undefined;
  }

  async create(transcript: string, items: QuickAddItem[]): Promise<VoiceCaptureRecord> {
    const now = new Date();
    const record: VoiceCaptureRecord = {
      id: newId(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + VOICE_CAPTURE_TTL_MS).toISOString(),
      transcript,
      items: items.map((item) => ({
        kind: item.kind,
        title: item.title,
        due: item.due,
        start: item.start,
        end: item.end,
        durationMinutes: item.durationMinutes,
        notes: item.notes,
      })),
    };
    await this.mutate(() => {
      this.captures.push(record);
    });
    return structuredClone(record);
  }

  async remove(id: string): Promise<boolean> {
    return this.mutate(() => {
      const before = this.captures.length;
      this.captures = this.captures.filter((row) => row.id !== id);
      return this.captures.length < before;
    });
  }
}
