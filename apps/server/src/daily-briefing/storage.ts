import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { DailyBriefingRecord } from "./types";

const DAY_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

export function briefingDayPath(dir: string, day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("invalid briefing day");
  return join(dir, `${day}.json`);
}

export async function ensureBriefingDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, path);
}

export async function readBriefingFile(path: string): Promise<DailyBriefingRecord | undefined> {
  try {
    const record = JSON.parse(await readFile(path, "utf8")) as DailyBriefingRecord;
    const { weather, calendar, topics } = record.sources;
    return {
      day: record.day, generatedAt: record.generatedAt, trigger: record.trigger,
      sources: { weather, calendar, topics: topics ?? { status: "not_configured", message: "This edition predates keyword briefings. Add topics in Settings and refresh today's edition." } },
    };
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function writeBriefingFile(path: string, rec: DailyBriefingRecord): Promise<void> {
  await writeAtomic(path, JSON.stringify(rec, null, 2));
}

/** List stored briefing days (YYYY-MM-DD), newest first. */
export async function listBriefingDays(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ENOENT") return [];
    throw err;
  }
  const days: string[] = [];
  for (const name of names) {
    const m = DAY_RE.exec(name);
    if (m) days.push(m[1]!);
  }
  days.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return days;
}
