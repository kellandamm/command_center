import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { KVStore } from "@homepage/agent-core";

/** Write-then-rename so a crash never leaves a half-written file. */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, path);
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (err: any) {
    if (err?.code === "ENOENT") return undefined;
    throw err;
  }
}

/** The agent-core KVStore backed by one JSON file. Writes are serialised. */
export class FileKV implements KVStore {
  private data: Record<string, unknown> = {};
  private queue: Promise<void> = Promise.resolve();
  private constructor(private path: string) {}

  static async open(path: string): Promise<FileKV> {
    const kv = new FileKV(path);
    kv.data = (await readJson<Record<string, unknown>>(path)) ?? {};
    return kv;
  }
  async get<T>(key: string): Promise<T | undefined> {
    return this.data[key] as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data[key] = value;
    await this.flush();
  }
  async remove(key: string): Promise<void> {
    delete this.data[key];
    await this.flush();
  }
  private flush(): Promise<void> {
    const run = this.queue.then(() => writeFileAtomic(this.path, JSON.stringify(this.data, null, 2)));
    this.queue = run.catch(() => {});
    return run;
  }
}

// ---------------------------------------------------------------------------
// spend ledger

export interface LedgerEntry {
  /** ISO timestamp. */
  ts: string;
  buildId: string;
  status: "ok" | "failed" | "cancelled" | "capped";
  costUsd: number;
  editionId?: string;
  note?: string;
}

/** Append-only JSONL. A build writes one line when it ends, however it ends. */
export class Ledger {
  constructor(private path: string) {}

  async append(entry: LedgerEntry): Promise<void> {
    await appendFile(this.path, JSON.stringify(entry) + "\n", { mode: 0o600 });
  }

  async all(): Promise<LedgerEntry[]> {
    let text = "";
    try {
      text = await readFile(this.path, "utf8");
    } catch (err: any) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
    const out: LedgerEntry[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // A torn last line from a crash must not take the whole ledger down.
      }
    }
    return out;
  }
}

/** Calendar-day and calendar-month keys in the configured zone ("2026-10-13", "2026-10"). */
export function dayKey(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts; // en-CA => YYYY-MM-DD
}
export const monthKey = (d: Date, tz: string) => dayKey(d, tz).slice(0, 7);

export function spendTotals(entries: LedgerEntry[], now: Date, tz: string) {
  const day = dayKey(now, tz);
  const month = monthKey(now, tz);
  let today = 0, thisMonth = 0, buildsToday = 0;
  for (const e of entries) {
    const d = new Date(e.ts);
    const k = dayKey(d, tz);
    if (k.slice(0, 7) === month) thisMonth += e.costUsd;
    if (k === day) {
      today += e.costUsd;
      buildsToday += 1;
    }
  }
  return { today, thisMonth, buildsToday };
}

// ---------------------------------------------------------------------------
// editions

export interface EditionMeta {
  id: string;
  createdAt: string;
  costUsd: number;
  trigger: "manual" | "schedule";
  model: string;
  sources: number;
  title: string;
  /** Short plain-text summary of what the agent said it built. */
  summary: string;
}

export const EDITION_ID = /^\d{8}-\d{6}-[0-9a-f]{4}$/;

export function newEditionId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-` +
    `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}-${randomBytes(2).toString("hex")}`
  );
}

export class EditionStore {
  constructor(private dir: string) {}

  private path(id: string, file?: string): string {
    if (!EDITION_ID.test(id)) throw new Error("bad edition id");
    return file ? join(this.dir, id, file) : join(this.dir, id);
  }

  async save(meta: EditionMeta, files: { tsx: string; doc: string }): Promise<void> {
    await mkdir(this.path(meta.id), { recursive: true });
    await writeFileAtomic(this.path(meta.id, "homepage.tsx"), files.tsx);
    await writeFileAtomic(this.path(meta.id, "doc.html"), files.doc);
    // meta.json last: an edition exists once it can be listed.
    await writeFileAtomic(this.path(meta.id, "meta.json"), JSON.stringify(meta, null, 2));
  }

  async list(): Promise<EditionMeta[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.dir);
    } catch (err: any) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
    const metas: EditionMeta[] = [];
    for (const name of names.filter((n) => EDITION_ID.test(n))) {
      const meta = await readJson<EditionMeta>(join(this.dir, name, "meta.json")).catch(() => undefined);
      if (meta) metas.push(meta);
    }
    return metas.sort((a, b) => b.id.localeCompare(a.id));
  }

  async meta(id: string): Promise<EditionMeta | undefined> {
    if (!EDITION_ID.test(id)) return undefined;
    return readJson<EditionMeta>(this.path(id, "meta.json"));
  }

  async doc(id: string): Promise<string | undefined> {
    if (!EDITION_ID.test(id)) return undefined;
    try {
      return await readFile(this.path(id, "doc.html"), "utf8");
    } catch {
      return undefined;
    }
  }

  async latest(): Promise<EditionMeta | undefined> {
    return (await this.list())[0];
  }

  async remove(id: string): Promise<void> {
    await rm(this.path(id), { recursive: true, force: true });
  }

  /** Keep the newest `keep` editions. */
  async prune(keep: number): Promise<number> {
    const all = await this.list();
    const doomed = all.slice(Math.max(1, keep));
    for (const m of doomed) await this.remove(m.id);
    return doomed.length;
  }
}

export async function ensureDirs(dataDir: string): Promise<{ editions: string }> {
  const editions = join(dataDir, "editions");
  await mkdir(editions, { recursive: true, mode: 0o700 });
  return { editions };
}
