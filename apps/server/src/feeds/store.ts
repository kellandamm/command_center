import { createHash } from "node:crypto";
import { join } from "node:path";
import { readJson, writeFileAtomic } from "../store";

export interface StoredItem {
  id: string;
  feedId: string;
  title: string;
  link?: string;
  summary?: string;
  publishedAt?: string;
  firstSeenAt: string;
  read: boolean;
}

export interface FeedStatus {
  feedId: string;
  lastFetchAt?: string;
  lastError?: string;
  itemCount: number;
}

interface FeedsData {
  items: StoredItem[];
  feeds: Record<string, { lastFetchAt?: string; lastError?: string }>;
}

const MAX_ITEMS = 2000;

export function itemId(feedId: string, link: string | undefined, title: string): string {
  const key = link || title;
  return createHash("sha256").update(`${feedId}\0${key}`).digest("hex").slice(0, 24);
}

export class FeedsStore {
  private data: FeedsData = { items: [], feeds: {} };
  constructor(private path: string) {}

  static async open(dir: string): Promise<FeedsStore> {
    const store = new FeedsStore(join(dir, "feeds.json"));
    const saved = await readJson<FeedsData>(store.path);
    if (saved?.items) store.data = saved;
    return store;
  }

  async save(): Promise<void> {
    await writeFileAtomic(this.path, JSON.stringify(this.data, null, 2));
  }

  list(opts: { unreadOnly?: boolean; limit?: number } = {}): StoredItem[] {
    let items = [...this.data.items].sort((a, b) => (b.firstSeenAt > a.firstSeenAt ? 1 : -1));
    if (opts.unreadOnly) items = items.filter((i) => !i.read);
    if (opts.limit) items = items.slice(0, opts.limit);
    return items;
  }

  unreadSince(sinceIso: string): StoredItem[] {
    return this.data.items.filter((i) => !i.read && i.firstSeenAt >= sinceIso);
  }

  itemsForBriefing(sinceIso: string, limit = 40): StoredItem[] {
    const fresh = this.data.items.filter((i) => i.firstSeenAt >= sinceIso);
    return fresh.slice(0, limit);
  }

  markRead(ids: string[]): number {
    const set = new Set(ids);
    let n = 0;
    for (const it of this.data.items) {
      if (set.has(it.id) && !it.read) {
        it.read = true;
        n++;
      }
    }
    return n;
  }

  markAllRead(): number {
    let n = 0;
    for (const it of this.data.items) {
      if (!it.read) {
        it.read = true;
        n++;
      }
    }
    return n;
  }

  ingest(feedId: string, incoming: Array<{ title: string; link?: string; summary?: string; date?: string; meta?: string }>, now: Date): number {
    const nowIso = now.toISOString();
    let added = 0;
    const known = new Set(this.data.items.map((i) => i.id));
    for (const raw of incoming) {
      if (!raw.title) continue;
      const id = itemId(feedId, raw.link, raw.title);
      if (known.has(id)) continue;
      known.add(id);
      this.data.items.push({
        id,
        feedId,
        title: raw.title,
        link: raw.link,
        summary: raw.summary ?? raw.meta,
        publishedAt: raw.date,
        firstSeenAt: nowIso,
        read: false,
      });
      added++;
    }
    this.data.items.sort((a, b) => (a.firstSeenAt < b.firstSeenAt ? 1 : -1));
    if (this.data.items.length > MAX_ITEMS) this.data.items = this.data.items.slice(0, MAX_ITEMS);
    const st = this.data.feeds[feedId] ?? {};
    st.lastFetchAt = nowIso;
    st.lastError = undefined;
    this.data.feeds[feedId] = st;
    return added;
  }

  setFeedError(feedId: string, message: string, now: Date): void {
    const st = this.data.feeds[feedId] ?? {};
    st.lastFetchAt = now.toISOString();
    st.lastError = message.slice(0, 500);
    this.data.feeds[feedId] = st;
  }

  statuses(feedIds: string[]): FeedStatus[] {
    return feedIds.map((feedId) => ({
      feedId,
      lastFetchAt: this.data.feeds[feedId]?.lastFetchAt,
      lastError: this.data.feeds[feedId]?.lastError,
      itemCount: this.data.items.filter((i) => i.feedId === feedId).length,
    }));
  }
}
