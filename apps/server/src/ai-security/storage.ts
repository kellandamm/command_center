import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { assertStoredRoundup } from "./validate";
import type { AiSecurityRoundup } from "./types";

const FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

export function roundupPath(dir: string, weekOf: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf)) throw new Error("invalid roundup weekOf");
  return join(dir, `${weekOf}.json`);
}

export async function ensureRoundupDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, path);
}

export async function readRoundupFile(path: string): Promise<AiSecurityRoundup | undefined> {
  try {
    const rec = JSON.parse(await readFile(path, "utf8")) as AiSecurityRoundup;
    assertStoredRoundup(rec);
    return rec;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function writeRoundupFile(path: string, rec: AiSecurityRoundup): Promise<void> {
  assertStoredRoundup(rec);
  await writeAtomic(path, JSON.stringify(rec, null, 2));
}

/** List stored roundup weeks (weekOf, YYYY-MM-DD), newest first. */
export async function listRoundupWeeks(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ENOENT") return [];
    throw err;
  }
  const weeks: string[] = [];
  for (const name of names) {
    const m = FILE_RE.exec(name);
    if (m) weeks.push(m[1]!);
  }
  weeks.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return weeks;
}
