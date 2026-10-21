import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { tokenEquals } from "../auth";
import { readJson, writeFileAtomic } from "../store";

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export class CaptureAccess {
  private path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "capture-access.json");
  }

  async configured(): Promise<boolean> {
    return Boolean((await readJson<{ hash?: string }>(this.path))?.hash);
  }

  async accepts(token: string): Promise<boolean> {
    if (!token || token.length > 200) return false;
    const saved = await readJson<{ hash?: string }>(this.path);
    return Boolean(saved?.hash && tokenEquals(saved.hash, digest(token)));
  }

  async rotate(): Promise<string> {
    const token = randomBytes(32).toString("hex");
    await writeFileAtomic(this.path, JSON.stringify({ hash: digest(token) }));
    return token;
  }

  async revoke(): Promise<void> {
    await writeFileAtomic(this.path, JSON.stringify({}));
  }
}
