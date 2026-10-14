import { join } from "node:path";
import { readJson, writeFileAtomic } from "../store";
import { ValidationError } from "../settings";

export interface NewsPrefs {
  /** Tag ids hidden from the tagged news feed. */
  mutedTags: string[];
  /** Tag ids to focus on; empty means all non-muted tags. */
  focusTags: string[];
}

const DEFAULT: NewsPrefs = { mutedTags: [], focusTags: [] };

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
    return { mutedTags: [...this.data.mutedTags], focusTags: [...this.data.focusTags] };
  }

  async update(patch: Partial<NewsPrefs>): Promise<NewsPrefs> {
    const next = normalizePrefs({ ...this.data, ...patch });
    this.data = next;
    await writeFileAtomic(this.path, JSON.stringify(next, null, 2));
    return this.get();
  }
}

function normalizePrefs(raw: NewsPrefs): NewsPrefs {
  const mutedTags = uniqStrings(raw.mutedTags, "mutedTags");
  const focusTags = uniqStrings(raw.focusTags, "focusTags");
  const muted = new Set(mutedTags);
  return { mutedTags, focusTags: focusTags.filter((t) => !muted.has(t)) };
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
