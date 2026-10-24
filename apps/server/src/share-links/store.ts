import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ValidationError } from "../settings";
import { readJson, writeFileAtomic } from "../store";

/** URL path segment: 128-bit id, base64url without padding. */
export const SHARE_LINK_ID_RE = /^[A-Za-z0-9_-]{22}$/;

export const SHARE_EXPIRY_SECONDS = [3600, 86_400, 604_800] as const;
export type ShareExpirySeconds = (typeof SHARE_EXPIRY_SECONDS)[number];

const recordSchema = z.object({
  id: z.string().regex(SHARE_LINK_ID_RE),
  noteId: z.string().min(1).max(200),
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export type ShareLinkRecord = z.infer<typeof recordSchema>;

const fileSchema = z.object({
  links: z.array(recordSchema).max(500),
});

function parseFile(raw: unknown): { links: ShareLinkRecord[] } {
  if (raw === undefined || raw === null) return { links: [] };
  const result = fileSchema.safeParse(raw);
  if (!result.success) throw new ValidationError("Invalid share-links.json");
  return result.data;
}

function isActive(link: ShareLinkRecord, now = Date.now()): boolean {
  return now < Date.parse(link.expiresAt);
}

export class ShareLinksStore {
  private queue: Promise<void> = Promise.resolve();
  private links: ShareLinkRecord[];

  private constructor(private path: string, links: ShareLinkRecord[]) {
    this.links = links;
  }

  static async open(dataDir: string): Promise<ShareLinksStore> {
    const path = join(dataDir, "share-links.json");
    let raw: unknown;
    try {
      raw = await readJson<unknown>(path);
    } catch {
      raw = undefined;
    }
    const store = new ShareLinksStore(path, parseFile(raw).links);
    await store.purgeExpired();
    return store;
  }

  private async persist(): Promise<void> {
    await writeFileAtomic(this.path, JSON.stringify({ links: this.links }, null, 2));
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

  async purgeExpired(): Promise<void> {
    await this.mutate(() => {
      const now = Date.now();
      this.links = this.links.filter((link) => isActive(link, now));
    });
  }

  activeCount(): number {
    const now = Date.now();
    return this.links.filter((link) => isActive(link, now)).length;
  }

  list(): ShareLinkRecord[] {
    const now = Date.now();
    return structuredClone(this.links.filter((link) => isActive(link, now)));
  }

  get(id: string): ShareLinkRecord | undefined {
    if (!SHARE_LINK_ID_RE.test(id)) return undefined;
    const link = this.links.find((row) => row.id === id);
    if (!link || !isActive(link)) return undefined;
    return structuredClone(link);
  }

  async create(input: {
    noteId: string;
    ciphertext: string;
    iv: string;
    expiresInSeconds: ShareExpirySeconds;
    maxActive: number;
    maxCiphertextBytes: number;
  }): Promise<ShareLinkRecord> {
    const noteId = input.noteId.trim();
    if (!noteId) throw new ValidationError("noteId is required");
    if (!SHARE_EXPIRY_SECONDS.includes(input.expiresInSeconds)) {
      throw new ValidationError("expiresInSeconds must be 3600, 86400, or 604800");
    }
    const ciphertext = input.ciphertext.trim();
    const iv = input.iv.trim();
    if (!ciphertext || !iv) throw new ValidationError("ciphertext and iv are required");
    if (Buffer.byteLength(ciphertext, "utf8") > input.maxCiphertextBytes) {
      throw new ValidationError(`ciphertext exceeds ${input.maxCiphertextBytes} bytes`);
    }
    if (!/^[A-Za-z0-9+/]+=*$/.test(ciphertext) || !/^[A-Za-z0-9+/]+=*$/.test(iv)) {
      throw new ValidationError("ciphertext and iv must be base64");
    }
    return this.mutate(() => {
      this.links = this.links.filter((link) => isActive(link));
      if (this.links.length >= input.maxActive) {
        throw new ValidationError("active share link limit reached");
      }
      const now = new Date();
      const expiresAt = new Date(now.getTime() + input.expiresInSeconds * 1000).toISOString();
      const id = randomBytes(16).toString("base64url");
      const record: ShareLinkRecord = {
        id,
        noteId,
        ciphertext,
        iv,
        expiresAt,
        createdAt: now.toISOString(),
      };
      this.links.push(record);
      return structuredClone(record);
    });
  }

  async revoke(id: string): Promise<boolean> {
    if (!SHARE_LINK_ID_RE.test(id)) return false;
    return this.mutate(() => {
      const before = this.links.length;
      this.links = this.links.filter((link) => link.id !== id);
      return this.links.length < before;
    });
  }
}
