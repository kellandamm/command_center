import { join } from "node:path";
import { readJson, writeFileAtomic } from "../store";

const FILE = "ntfy-sent.json";
const MAX_KEYS = 5_000;
const DEFAULT_PRUNE_MS = 14 * 24 * 60 * 60_000;

interface FileShape {
  keys: Record<string, number>;
}

function normalize(raw: unknown): FileShape {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { keys: {} };
  const keys = (raw as FileShape).keys;
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) return { keys: {} };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(keys)) {
    if (typeof k === "string" && typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return { keys: out };
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
