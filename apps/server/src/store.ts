import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

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

export interface KVStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

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

export function dayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export async function ensureDirs(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
}
