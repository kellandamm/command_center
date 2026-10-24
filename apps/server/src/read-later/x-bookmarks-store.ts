import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ValidationError } from "../settings";
import { readJson, writeFileAtomic } from "../store";

export type XBookmarkStatus = "pending" | "done" | "failed";

export interface XBookmarkItem {
  id: string;
  source: "x";
  postId: string;
  postUrl: string;
  authorHandle: string;
  text: string;
  articleUrl: string | null;
  summaryBullets: string[];
  whyItMatters: string | null;
  status: XBookmarkStatus;
  failureReason: string | null;
  attempts: number;
  unread: boolean;
  createdAt: string;
  importedAt: string;
}

const postId = z.string().trim().min(1).max(64);
const httpUrl = z.string().max(2_048).transform((value, ctx) => {
  try {
    const parsed = new URL(value);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    return parsed.href;
  } catch {
    ctx.addIssue({ code: "custom", message: "URL must use HTTP or HTTPS without credentials" });
    return z.NEVER;
  }
});

const importItemSchema = z.object({
  post_id: postId,
  post_url: httpUrl,
  author_handle: z.string().trim().min(1).max(64),
  text: z.string().max(8_000),
  created_at: z.string().refine((v) => Number.isFinite(Date.parse(v)), "created_at must be a valid date"),
  urls: z.array(httpUrl).max(20).default([]),
});

export const xBookmarkImportBodySchema = z.object({
  items: z.array(importItemSchema).max(100),
});

export type XBookmarkImportItem = z.infer<typeof importItemSchema>;

const itemSchema = z.object({
  id: z.string().min(1).max(100),
  source: z.literal("x"),
  postId: postId,
  postUrl: httpUrl,
  authorHandle: z.string().max(64),
  text: z.string().max(8_000),
  articleUrl: httpUrl.nullable(),
  summaryBullets: z.array(z.string().max(1_000)).max(10),
  whyItMatters: z.string().max(500).nullable(),
  status: z.enum(["pending", "done", "failed"]),
  failureReason: z.string().max(500).nullable(),
  attempts: z.number().int().min(0).max(10),
  unread: z.boolean(),
  createdAt: z.string(),
  importedAt: z.string(),
});

const dataSchema = z.object({
  items: z.array(itemSchema).max(10_000),
});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  return result.data;
}

export class XBookmarksStore {
  private queue: Promise<void> = Promise.resolve();
  private constructor(private path: string, private data: z.infer<typeof dataSchema>) {}

  static async open(dataDir: string): Promise<XBookmarksStore> {
    const path = join(dataDir, "x-bookmarks.json");
    const raw = await readJson<unknown>(path);
    const data = parse(dataSchema, raw ?? { items: [] });
    return new XBookmarksStore(path, data);
  }

  list(): XBookmarkItem[] {
    return structuredClone(this.data.items).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }

  getByPostId(postId: string): XBookmarkItem | undefined {
    return this.data.items.find((item) => item.postId === postId);
  }

  pendingForProcessing(): XBookmarkItem[] {
    return this.data.items.filter((item) => item.status === "pending" && item.attempts < 2);
  }

  private async mutate<T>(change: (data: z.infer<typeof dataSchema>) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const next = structuredClone(this.data);
      const result = change(next);
      parse(dataSchema, next);
      await writeFileAtomic(this.path, JSON.stringify(next, null, 2));
      this.data = next;
      return structuredClone(result) as T;
    });
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  async importItems(
    items: XBookmarkImportItem[],
  ): Promise<{ imported: number; duplicates: number; rejected: Array<{ post_id: string; reason: string }> }> {
    let imported = 0;
    let duplicates = 0;
    const rejected: Array<{ post_id: string; reason: string }> = [];
    const accepted: XBookmarkImportItem[] = [];
    for (const item of items) {
      const parsed = importItemSchema.safeParse(item);
      if (!parsed.success) {
        rejected.push({ post_id: String((item as { post_id?: string }).post_id ?? ""), reason: parsed.error.issues[0]?.message ?? "invalid item" });
        continue;
      }
      accepted.push(parsed.data);
    }
    await this.mutate((data) => {
      for (const item of accepted) {
        if (data.items.some((row) => row.postId === item.post_id)) {
          duplicates++;
          continue;
        }
        const now = new Date().toISOString();
        const articleUrl = item.urls.find((url) => !url.includes("x.com/") && !url.includes("twitter.com/")) ?? item.urls[0] ?? null;
        data.items.push({
          id: randomUUID(),
          source: "x",
          postId: item.post_id,
          postUrl: item.post_url,
          authorHandle: item.author_handle,
          text: item.text,
          articleUrl: articleUrl ?? null,
          summaryBullets: [],
          whyItMatters: null,
          status: "pending",
          failureReason: null,
          attempts: 0,
          unread: true,
          createdAt: new Date(item.created_at).toISOString(),
          importedAt: now,
        });
        imported++;
      }
    });
    return { imported, duplicates, rejected };
  }

  async markRead(postId: string): Promise<XBookmarkItem | undefined> {
    return this.mutate((data) => {
      const item = data.items.find((row) => row.postId === postId);
      if (!item) return undefined;
      item.unread = false;
      return item;
    });
  }

  async recordAttempt(postId: string): Promise<void> {
    await this.mutate((data) => {
      const item = data.items.find((row) => row.postId === postId);
      if (item) item.attempts += 1;
    });
  }

  async markDone(postId: string, summaryBullets: string[], whyItMatters: string): Promise<void> {
    await this.mutate((data) => {
      const item = data.items.find((row) => row.postId === postId);
      if (!item) return;
      item.summaryBullets = summaryBullets;
      item.whyItMatters = whyItMatters;
      item.status = "done";
      item.failureReason = null;
    });
  }

  async markFailed(postId: string, reason: string): Promise<void> {
    await this.mutate((data) => {
      const item = data.items.find((row) => row.postId === postId);
      if (!item) return;
      item.failureReason = reason.slice(0, 500);
      item.status = item.attempts >= 2 ? "failed" : "pending";
    });
  }
}
