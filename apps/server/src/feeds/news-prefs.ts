import { join } from "node:path";
import { readJson, writeFileAtomic } from "../store";
import { ValidationError } from "../settings";

export interface NewsPrefs {
  /** Tag ids hidden from the tagged news feed. */
  mutedTags: string[];
  /** Tag ids to focus on; empty means all non-muted tags. */
  focusTags: string[];
  /** Auto-summarize when an article is starred. */
  summarizeAutoStarred?: boolean;
  /** Folder ids to auto-summarize new articles from. */
  summarizeFolderIds?: string[];
  /** Max LLM summaries per rolling hour (default 10). */
  summarizeMaxPerHour?: number;
}

const DEFAULT: NewsPrefs = { mutedTags: [], focusTags: [], summarizeAutoStarred: false, summarizeFolderIds: [], summarizeMaxPerHour: 10 };

export class NewsPrefsStore {
  private data: NewsPrefs = { ...DEFAULT };

  constructor(private path: string) {}

  static async open(dataDir: string): Promise<NewsPrefsStore> {
    const store = new NewsPrefsStore(join(dataDir, "news-prefs.json"));
    const saved = await readJson<NewsPrefs>(store.path);
    if (saved) store.data = normalizePrefs(saved);
    return store;
  }

  get(): NewsPrefs {
    return {
      mutedTags: [...this.data.mutedTags],
      focusTags: [...this.data.focusTags],
      summarizeAutoStarred: this.data.summarizeAutoStarred,
      summarizeFolderIds: [...(this.data.summarizeFolderIds ?? [])],
      summarizeMaxPerHour: this.data.summarizeMaxPerHour,
    };
  }

  async update(patch: Partial<NewsPrefs> & Record<string, unknown>): Promise<NewsPrefs> {
    const next = normalizePrefs({ ...this.data, ...patch } as NewsPrefs);
    this.data = next;
    await writeFileAtomic(this.path, JSON.stringify(next, null, 2));
    return this.get();
  }
}

function normalizePrefs(raw: NewsPrefs): NewsPrefs {
  const mutedTags = uniqStrings(raw.mutedTags, "mutedTags");
  const focusTags = uniqStrings(raw.focusTags, "focusTags");
  const muted = new Set(mutedTags);
  const summarizeFolderIds = raw.summarizeFolderIds ? uniqStrings(raw.summarizeFolderIds, "summarizeFolderIds") : [];
  let summarizeMaxPerHour = raw.summarizeMaxPerHour ?? 10;
  if (!Number.isInteger(summarizeMaxPerHour) || summarizeMaxPerHour < 0 || summarizeMaxPerHour > 60) {
    throw new ValidationError("summarizeMaxPerHour must be 0–60");
  }
  return {
    mutedTags,
    focusTags: focusTags.filter((t) => !muted.has(t)),
    summarizeAutoStarred: Boolean(raw.summarizeAutoStarred),
    summarizeFolderIds,
    summarizeMaxPerHour,
  };
}

function uniqStrings(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) throw new ValidationError(`${field} must be an array`);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x !== "string" || !x.trim()) throw new ValidationError(`${field} entries must be non-empty strings`);
    const id = x.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
