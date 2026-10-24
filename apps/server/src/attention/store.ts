import { join } from "node:path";
import { ValidationError } from "../settings";
import { readJson, writeFileAtomic } from "../store";

export interface AttentionFile {
  pinned: string[];
  snoozed: Record<string, string>;
  hidden: string[];
}

const empty: AttentionFile = { pinned: [], snoozed: {}, hidden: [] };

function pruneSnoozes(snoozed: Record<string, string>, now = Date.now()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, until] of Object.entries(snoozed)) {
    const t = Date.parse(until);
    if (Number.isFinite(t) && t > now) out[id] = until;
  }
  return out;
}

function normalize(raw: unknown): AttentionFile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...empty };
  const obj = raw as Record<string, unknown>;
  const pinned = Array.isArray(obj.pinned) ? obj.pinned.filter((x): x is string => typeof x === "string") : [];
  const hidden = Array.isArray(obj.hidden) ? obj.hidden.filter((x): x is string => typeof x === "string") : [];
  const snoozed: Record<string, string> = {};
  if (obj.snoozed && typeof obj.snoozed === "object" && !Array.isArray(obj.snoozed)) {
    for (const [k, v] of Object.entries(obj.snoozed as Record<string, unknown>)) {
      if (typeof v === "string" && Number.isFinite(Date.parse(v))) snoozed[k] = v;
    }
  }
  return { pinned, hidden, snoozed: pruneSnoozes(snoozed) };
}

export class AttentionStore {
  private queue: Promise<void> = Promise.resolve();
  private data: AttentionFile;

  private constructor(private path: string, data: AttentionFile) {
    this.data = data;
  }

  static async open(dataDir: string): Promise<AttentionStore> {
    const path = join(dataDir, "attention.json");
    let raw: unknown;
    try {
      raw = await readJson<unknown>(path);
    } catch {
      raw = undefined;
    }
    return new AttentionStore(path, normalize(raw));
  }

  snapshot(): AttentionFile {
    return structuredClone(this.data);
  }

  isSnoozed(id: string, now = Date.now()): boolean {
    const until = this.data.snoozed[id];
    if (!until) return false;
    return Date.parse(until) > now;
  }

  isHidden(id: string): boolean {
    return this.data.hidden.includes(id);
  }

  isPinned(id: string): boolean {
    return this.data.pinned.includes(id);
  }

  private async persist(): Promise<void> {
    this.data.snoozed = pruneSnoozes(this.data.snoozed);
    await writeFileAtomic(this.path, JSON.stringify(this.data, null, 2));
  }

  private async mutate<T>(fn: () => T): Promise<T> {
    const run = this.queue.then(async () => {
      const result = fn();
      await this.persist();
      return result;
    });
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    if (!id) throw new ValidationError("id is required");
    await this.mutate(() => {
      const set = new Set(this.data.pinned);
      if (pinned) set.add(id);
      else set.delete(id);
      this.data.pinned = [...set];
    });
  }

  async setHidden(id: string, hidden: boolean): Promise<void> {
    if (!id) throw new ValidationError("id is required");
    await this.mutate(() => {
      const set = new Set(this.data.hidden);
      if (hidden) set.add(id);
      else set.delete(id);
      this.data.hidden = [...set];
    });
  }

  async snooze(id: string, untilIso: string): Promise<void> {
    if (!id) throw new ValidationError("id is required");
    if (!Number.isFinite(Date.parse(untilIso))) throw new ValidationError("until must be a valid ISO timestamp");
    await this.mutate(() => {
      this.data.snoozed[id] = untilIso;
    });
  }

  async clearSnooze(id: string): Promise<void> {
    await this.mutate(() => {
      delete this.data.snoozed[id];
    });
  }
}

export function snoozeUntil(option: "1d" | "1w" | string, now = new Date()): string {
  if (option === "1d") {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }
  if (option === "1w") {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString();
  }
  if (!Number.isFinite(Date.parse(option))) throw new ValidationError("until must be 1d, 1w, or an ISO date");
  return new Date(option).toISOString();
}
