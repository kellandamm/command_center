import { safeFetch } from "../ssrf";
import type { FeedSpec } from "./parse";
import { parseFeed } from "./parse";
import type { FeedsStore } from "./store";

async function getJson(url: string): Promise<any> {
  const res = await safeFetch(url, { headers: { accept: "application/json" }, maxBytes: 2_000_000 });
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.body);
}

async function fetchHn(): Promise<Array<{ title: string; link?: string; summary?: string; date?: string; meta?: string }>> {
  const ids: number[] = (await getJson("https://hacker-news.firebaseio.com/v0/topstories.json")).slice(0, 35);
  const items = await Promise.all(
    ids.map((id) => getJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)),
  );
  return items
    .filter((it) => it && it.title && !it.dead && !it.deleted)
    .map((it) => ({
      title: String(it.title),
      link: it.url ?? `https://news.ycombinator.com/item?id=${it.id}`,
      meta: `${it.score ?? 0} pts · ${it.descendants ?? 0} comments`,
      date: it.time ? new Date(it.time * 1000).toISOString() : undefined,
    }));
}

async function fetchRss(url: string): Promise<Array<{ title: string; link?: string; summary?: string; date?: string }>> {
  const res = await safeFetch(url, {
    headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  return parseFeed(res.body, res.finalUrl).slice(0, 40);
}

export async function fetchOneFeed(spec: FeedSpec): Promise<Array<{ title: string; link?: string; summary?: string; date?: string; meta?: string }>> {
  if (spec.id === "hn") return fetchHn();
  return fetchRss(spec.url);
}

export interface FetchResult {
  feedId: string;
  added: number;
  error?: string;
}

export async function fetchAllFeeds(store: FeedsStore, specs: FeedSpec[], now = new Date()): Promise<FetchResult[]> {
  const out: FetchResult[] = [];
  for (const spec of specs) {
    try {
      const items = await fetchOneFeed(spec);
      const added = store.ingest(spec.id, items, now);
      out.push({ feedId: spec.id, added });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.setFeedError(spec.id, message, now);
      out.push({ feedId: spec.id, added: 0, error: message });
    }
  }
  await store.save();
  return out;
}
