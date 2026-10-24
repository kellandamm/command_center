import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ValidationError } from "../settings";
import { readJson, writeFileAtomic } from "../store";

const linkSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  url: z.string().max(2_048),
  emoji: z.string().max(8).optional(),
});

const fileSchema = z.object({
  links: z.array(linkSchema).max(200),
});

export type LaunchpadLink = z.infer<typeof linkSchema>;

function parseUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error();
    }
    return parsed.href;
  } catch {
    throw new ValidationError("URL must use HTTP or HTTPS without credentials");
  }
}

function parseFile(raw: unknown): { links: LaunchpadLink[] } {
  if (raw === undefined || raw === null) return { links: [] };
  const result = fileSchema.safeParse(raw);
  if (!result.success) return { links: [] };
  return result.data;
}

export class LaunchpadStore {
  private queue: Promise<void> = Promise.resolve();
  private links: LaunchpadLink[];

  private constructor(private path: string, links: LaunchpadLink[]) {
    this.links = links;
  }

  static async open(dataDir: string): Promise<LaunchpadStore> {
    const path = join(dataDir, "launchpad.json");
    let raw: unknown;
    try {
      raw = await readJson<unknown>(path);
    } catch {
      raw = undefined;
    }
    const data = parseFile(raw);
    const links = data.links.map((link) => ({ ...link, url: parseUrl(link.url) }));
    return new LaunchpadStore(path, links);
  }

  list(): LaunchpadLink[] {
    return structuredClone(this.links);
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

  async add(input: { label: string; url: string; emoji?: string }): Promise<LaunchpadLink> {
    const label = input.label.trim();
    if (!label) throw new ValidationError("label is required");
    const url = parseUrl(input.url.trim());
    const emoji = input.emoji?.trim() || undefined;
    return this.mutate(() => {
      const link: LaunchpadLink = { id: randomUUID(), label: label.slice(0, 120), url, emoji };
      this.links.push(link);
      return structuredClone(link);
    });
  }

  async update(id: string, input: { label?: string; url?: string; emoji?: string | null }): Promise<LaunchpadLink | undefined> {
    const idx = this.links.findIndex((l) => l.id === id);
    if (idx < 0) return undefined;
    return this.mutate(() => {
      const current = this.links[idx]!;
      const next: LaunchpadLink = {
        id: current.id,
        label: input.label !== undefined ? input.label.trim().slice(0, 120) || current.label : current.label,
        url: input.url !== undefined ? parseUrl(input.url.trim()) : current.url,
        emoji: input.emoji === null ? undefined : input.emoji !== undefined ? input.emoji.trim() || undefined : current.emoji,
      };
      this.links[idx] = next;
      return structuredClone(next);
    });
  }

  async remove(id: string): Promise<boolean> {
    const idx = this.links.findIndex((l) => l.id === id);
    if (idx < 0) return false;
    return this.mutate(() => {
      this.links.splice(idx, 1);
      return true;
    });
  }
}

export function validateLaunchpadUrl(value: string): string {
  return parseUrl(value);
}
