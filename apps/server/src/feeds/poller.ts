import { safeFetch } from "../ssrf";
import type { FeedsStore, FeedRow } from "./store";
import { HN_API_URL, HN_FEED_ID, parseFeed, type ParsedItem } from "./parse";
import { POLL } from "./retention";

export interface FeedHttpResult {
  status: number;
  body: string;
  finalUrl: string;
  etag?: string;
  lastModified?: string;
}

export type FeedHttpFn = (url: string, cond?: { etag?: string; lastModified?: string }) => Promise<FeedHttpResult>;

export async function defaultFeedHttp(url: string, cond?: { etag?: string; lastModified?: string }): Promise<FeedHttpResult> {
  const headers: Record<string, string> = {
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, */*",
  };
  if (cond?.etag) headers["if-none-match"] = cond.etag;
  if (cond?.lastModified) headers["if-modified-since"] = cond.lastModified;
  const res = await safeFetch(url, { headers });
  return {
    status: res.status,
    body: res.body,
    finalUrl: res.finalUrl,
    etag: res.headers.etag,
    lastModified: res.headers["last-modified"],
  };
}

async function fetchHnItems(): Promise<ParsedItem[]> {
  const res = await safeFetch(HN_API_URL, { headers: { accept: "application/json" }, maxBytes: 2_000_000 });
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  const ids: number[] = JSON.parse(res.body).slice(0, 35);
  const items = await Promise.all(
    ids.map(async (id) => {
      const r = await safeFetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
        headers: { accept: "application/json" },
        maxBytes: 500_000,
      });
      if (r.status < 200 || r.status >= 300) return null;
      const it = JSON.parse(r.body);
      if (!it?.title || it.dead || it.deleted) return null;
      return {
        title: String(it.title),
        link: it.url ?? `https://news.ycombinator.com/item?id=${it.id}`,
        guid: String(it.id),
        meta: `${it.score ?? 0} pts · ${it.descendants ?? 0} comments`,
        summary: `${it.score ?? 0} pts · ${it.descendants ?? 0} comments`,
        date: it.time ? new Date(it.time * 1000).toISOString() : undefined,
      } satisfies ParsedItem;
    }),
  );
  return items.filter(Boolean) as ParsedItem[];
}

export async function fetchFeedItems(row: FeedRow, http: FeedHttpFn = defaultFeedHttp): Promise<{ notModified: boolean; items: ParsedItem[]; etag?: string; lastModified?: string }> {
  if (row.isHn || row.id === HN_FEED_ID) {
    const items = await fetchHnItems();
    return { notModified: false, items };
  }
  const res = await http(row.xmlUrl, { etag: row.etag, lastModified: row.lastModified });
  if (res.status === 304) return { notModified: true, items: [], etag: res.etag ?? row.etag, lastModified: res.lastModified ?? row.lastModified };
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  const items = parseFeed(res.body, res.finalUrl).slice(0, 60);
  return { notModified: false, items, etag: res.etag, lastModified: res.lastModified };
}

export async function pollDueFeeds(
  store: FeedsStore,
  now = new Date(),
  http: FeedHttpFn = defaultFeedHttp,
  onNewEntries?: (entryIds: string[], feedId: string) => void | Promise<void>,
): Promise<Array<{ feedId: string; added: number; error?: string }>> {
  const due = store.dueFeeds(now, POLL.dueBatchSize);
  const out: Array<{ feedId: string; added: number; error?: string }> = [];
  let i = 0;
  async function worker() {
    while (i < due.length) {
      const row = due[i++]!;
      try {
        const fetched = await fetchFeedItems(row, http);
        const ingested = fetched.notModified ? { added: 0, ids: [] as string[] } : store.ingestParsed(row.id, fetched.items, now);
        if (ingested.ids.length && onNewEntries) await onNewEntries(ingested.ids, row.id);
        store.recordFetchSuccess(row.id, now, { etag: fetched.etag, lastModified: fetched.lastModified, notModified: fetched.notModified });
        out.push({ feedId: row.id, added: ingested.added });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        store.recordFetchError(row.id, message, now);
        out.push({ feedId: row.id, added: 0, error: message });
      }
    }
  }
  const workers = Array.from({ length: Math.min(POLL.maxConcurrent, due.length) }, () => worker());
  await Promise.all(workers);
  store.runRetention(now);
  return out;
}
