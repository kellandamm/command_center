import { join } from "node:path";
import {
  ensureRoundupDir,
  listRoundupWeeks,
  readRoundupFile,
  roundupPath,
  writeRoundupFile,
} from "./storage";
import type { AiSecurityRoundup } from "./types";
import { parsePublishPayload } from "./validate";

export class AiSecurityService {
  private dir: string;

  private constructor(dir: string) {
    this.dir = dir;
  }

  static async open(dataDir: string): Promise<AiSecurityService> {
    const dir = join(dataDir, "ai-security");
    await ensureRoundupDir(dir);
    return new AiSecurityService(dir);
  }

  async listWeeks(): Promise<string[]> {
    return listRoundupWeeks(this.dir);
  }

  async get(weekOf: string): Promise<AiSecurityRoundup | undefined> {
    return readRoundupFile(roundupPath(this.dir, weekOf));
  }

  async latest(): Promise<AiSecurityRoundup | undefined> {
    const weeks = await this.listWeeks();
    if (!weeks.length) return undefined;
    return this.get(weeks[0]!);
  }

  async publish(body: unknown): Promise<AiSecurityRoundup> {
    const parsed = parsePublishPayload(body);
    const rec: AiSecurityRoundup = {
      ...parsed,
      publishedAt: new Date().toISOString(),
    };
    await writeRoundupFile(roundupPath(this.dir, rec.weekOf), rec);
    return rec;
  }
}
