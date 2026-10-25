import { join } from "node:path";
import { readJson, writeFileAtomic } from "../store";

const FILE = "ntfy-sent.json";
const MAX_KEYS = 5_000;
const DEFAULT_PRUNE_MS = 14 * 24 * 60 * 60_000;

export const PENDING_DIGEST_MAX_MS = 6 * 60 * 60_000;

export interface PendingDigest {
  slot: string;
  body: string;
  click?: string;
  createdAt: number;
}

interface FileShape {
  keys: Record<string, number>;
  pendingDigest?: PendingDigest;
}

function normalize(raw: unknown): FileShape {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { keys: {} };
  const obj = raw as FileShape;
  const keys = obj.keys;
  const out: Record<string, number> = {};
  if (keys && typeof keys === "object" && !Array.isArray(keys)) {
    for (const [k, v] of Object.entries(keys)) {
      if (typeof k === "string" && typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
  }
  let pendingDigest: PendingDigest | undefined;
  const p = obj.pendingDigest;
  if (p && typeof p === "object" && typeof p.slot === "string" && typeof p.body === "string" && typeof p.createdAt === "number") {
    pendingDigest = {
      slot: p.slot,
      body: p.body,
      createdAt: p.createdAt,
      click: typeof p.click === "string" ? p.click : undefined,
    };
  }
  return { keys: out, pendingDigest };
}

export class NtfySentSet {
  private queue: Promise<void> = Promise.resolve();
  private data: FileShape;

  private constructor(private path: string, data: FileShape) {
    this.data = data;
  }

  static async open(dataDir: string): Promise<NtfySentSet> {
    const path = join(dataDir, FILE);
    let raw: unknown;
    try {
      raw = await readJson<unknown>(path);
    } catch {
      raw = undefined;
    }
    return new NtfySentSet(path, normalize(raw));
  }

  has(key: string): boolean {
    return Object.hasOwn(this.data.keys, key);
  }

  pendingDigest(): PendingDigest | undefined {
    return this.data.pendingDigest ? { ...this.data.pendingDigest } : undefined;
  }

  async mark(key: string, atMs = Date.now()): Promise<void> {
    const run = this.queue.then(async () => {
      this.data.keys[key] = atMs;
      const entries = Object.entries(this.data.keys);
      if (entries.length > MAX_KEYS) {
        entries.sort((a, b) => a[1] - b[1]);
        for (const [k] of entries.slice(0, entries.length - MAX_KEYS)) delete this.data.keys[k];
      }
      await writeFileAtomic(this.path, JSON.stringify(this.data));
    });
    this.queue = run.then(() => {}, () => {});
    await run;
  }

  async setPendingDigest(pending: PendingDigest): Promise<void> {
    const run = this.queue.then(async () => {
      this.data.pendingDigest = pending;
      await writeFileAtomic(this.path, JSON.stringify(this.data));
    });
    this.queue = run.then(() => {}, () => {});
    await run;
  }

  async clearPendingDigest(): Promise<void> {
    const run = this.queue.then(async () => {
      delete this.data.pendingDigest;
      await writeFileAtomic(this.path, JSON.stringify(this.data));
    });
    this.queue = run.then(() => {}, () => {});
    await run;
  }

  async prune(maxAgeMs = DEFAULT_PRUNE_MS, nowMs = Date.now()): Promise<void> {
    const run = this.queue.then(async () => {
      const cutoff = nowMs - maxAgeMs;
      let changed = false;
      for (const [k, t] of Object.entries(this.data.keys)) {
        if (t < cutoff) {
          delete this.data.keys[k];
          changed = true;
        }
      }
      if (changed) await writeFileAtomic(this.path, JSON.stringify(this.data));
    });
    this.queue = run.then(() => {}, () => {});
    await run;
  }
}
