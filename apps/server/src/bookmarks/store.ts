import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ValidationError } from "../settings";
import { readJson, writeFileAtomic } from "../store";

const title = z.string().trim().min(1).max(240);
const id = z.string().min(1).max(100);
const url = z.string().max(2_048).transform((value, ctx) => {
  try {
    const parsed = new URL(value);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    return parsed.href;
  } catch {
    ctx.addIssue({ code: "custom", message: "URL must use HTTP or HTTPS without credentials" });
    return z.NEVER;
  }
});
const groupSchema = z.object({ id, name: title });
const bookmarkSchema = z.object({ id, groupId: id, title, url, description: z.string().trim().max(1_000).default("") });
const preferencesSchema = z.object({
  density: z.enum(["comfortable", "compact"]).default("comfortable"),
  columns: z.number().int().min(1).max(4).default(3),
});
const dataSchema = z.object({
  groups: z.array(groupSchema).max(100),
  bookmarks: z.array(bookmarkSchema).max(5_000),
  preferences: preferencesSchema.default({ density: "comfortable", columns: 3 }),
});
const importSchema = z.object({
  groups: z.array(groupSchema).max(100),
  bookmarks: z.array(bookmarkSchema.omit({ id: true })).max(5_000),
});

export type Bookmark = z.infer<typeof bookmarkSchema>;
export type BookmarkGroup = z.infer<typeof groupSchema>;
export type BookmarksData = z.infer<typeof dataSchema>;

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ValidationError(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  return result.data;
}

function validateReferences(data: { groups: BookmarkGroup[]; bookmarks: Array<{ groupId: string }> }): void {
  const ids = new Set(data.groups.map((group) => group.id));
  if (ids.size !== data.groups.length) throw new ValidationError("Duplicate group IDs");
  if (data.bookmarks.some((bookmark) => !ids.has(bookmark.groupId))) throw new ValidationError("Bookmark group not found");
}

export class BookmarksStore {
  private queue: Promise<void> = Promise.resolve();
  private constructor(private path: string, private data: BookmarksData) {}

  static async open(dataDir: string): Promise<BookmarksStore> {
    const path = join(dataDir, "bookmarks.json");
    const data = parse(dataSchema, await readJson<unknown>(path) ?? { groups: [], bookmarks: [] });
    validateReferences(data);
    if (new Set(data.bookmarks.map((bookmark) => bookmark.id)).size !== data.bookmarks.length) {
      throw new ValidationError("Duplicate bookmark IDs");
    }
    return new BookmarksStore(path, data);
  }

  list(): BookmarksData { return structuredClone(this.data); }

  private async mutate<T>(change: (data: BookmarksData) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const next = structuredClone(this.data);
      const result = change(next);
      parse(dataSchema, next);
      validateReferences(next);
      await writeFileAtomic(this.path, JSON.stringify(next, null, 2));
      this.data = next;
      return structuredClone(result);
    });
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  async createGroup(input: unknown): Promise<BookmarkGroup> {
    const { name } = parse(groupSchema.pick({ name: true }), input);
    return this.mutate((data) => {
      const group = { id: randomUUID(), name };
      data.groups.push(group);
      return group;
    });
  }

  async updateGroup(input: unknown): Promise<void> {
    const patch = parse(z.object({ id, name: title.optional(), direction: z.enum(["up", "down"]).optional() }), input);
    await this.mutate((data) => {
      const index = data.groups.findIndex((group) => group.id === patch.id);
      if (index < 0) throw new ValidationError("Group not found");
      if (patch.name !== undefined) data.groups[index]!.name = patch.name;
      if (patch.direction) {
        const destination = index + (patch.direction === "up" ? -1 : 1);
        if (destination >= 0 && destination < data.groups.length) {
          const [group] = data.groups.splice(index, 1);
          data.groups.splice(destination, 0, group!);
        }
      }
    });
  }

  async deleteGroup(input: unknown): Promise<void> {
    const { id: groupId } = parse(z.object({ id }), input);
    await this.mutate((data) => {
      if (!data.groups.some((group) => group.id === groupId)) throw new ValidationError("Group not found");
      if (data.bookmarks.some((bookmark) => bookmark.groupId === groupId)) throw new ValidationError("Move or remove this group's bookmarks before deleting it");
      data.groups = data.groups.filter((group) => group.id !== groupId);
    });
  }

  async saveBookmark(input: unknown, update = false): Promise<Bookmark> {
    const value = update
      ? parse(bookmarkSchema, input)
      : { ...parse(bookmarkSchema.omit({ id: true }), input), id: randomUUID() };
    return this.mutate((data) => {
      const bookmark: Bookmark = value;
      if (update) {
        const index = data.bookmarks.findIndex((item) => item.id === bookmark.id);
        if (index < 0) throw new ValidationError("Bookmark not found");
        data.bookmarks[index] = bookmark;
      } else data.bookmarks.push(bookmark);
      return bookmark;
    });
  }

  async deleteBookmark(input: unknown): Promise<void> {
    const { id: bookmarkId } = parse(z.object({ id }), input);
    await this.mutate((data) => {
      if (!data.bookmarks.some((bookmark) => bookmark.id === bookmarkId)) throw new ValidationError("Bookmark not found");
      data.bookmarks = data.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId);
    });
  }

  async moveBookmark(input: unknown): Promise<void> {
    const patch = parse(z.object({ id, direction: z.enum(["up", "down"]) }), input);
    await this.mutate((data) => {
      const index = data.bookmarks.findIndex((item) => item.id === patch.id);
      if (index < 0) throw new ValidationError("Bookmark not found");
      const bookmark = data.bookmarks[index]!;
      let destination = index + (patch.direction === "up" ? -1 : 1);
      while (destination >= 0 && destination < data.bookmarks.length) {
        if (data.bookmarks[destination]!.groupId === bookmark.groupId) {
          [data.bookmarks[index], data.bookmarks[destination]] = [data.bookmarks[destination]!, bookmark];
          break;
        }
        destination += patch.direction === "up" ? -1 : 1;
      }
    });
  }

  async preferences(input: unknown): Promise<void> {
    const preferences = parse(preferencesSchema, input);
    await this.mutate((data) => { data.preferences = preferences; });
  }

  async import(input: unknown): Promise<{ added: number; skipped: number }> {
    const imported = parse(importSchema, input);
    validateReferences(imported);
    if (!imported.bookmarks.length) throw new ValidationError("No bookmarks found in this file");
    return this.mutate((data) => {
      const mapping = new Map<string, string>();
      for (const group of imported.groups) {
        let target = data.groups.find((item) => item.name.toLowerCase() === group.name.toLowerCase());
        if (!target) { target = { id: randomUUID(), name: group.name }; data.groups.push(target); }
        mapping.set(group.id, target.id);
      }
      let added = 0, skipped = 0;
      for (const item of imported.bookmarks) {
        const groupId = mapping.get(item.groupId)!;
        if (data.bookmarks.some((existing) => existing.groupId === groupId && existing.url === item.url)) { skipped++; continue; }
        data.bookmarks.push({ ...item, id: randomUUID(), groupId });
        added++;
      }
      return { added, skipped };
    });
  }
}
