import type { IncomingMessage, ServerResponse } from "node:http";
import type { FeedsStore } from "./store";
import type { NewsPrefsStore } from "./news-prefs";
import { TOPIC_TAGS, tagsForItem } from "./topics";
import { ValidationError } from "../settings";

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

export interface TaggedNewsItem {
  id: string;
  feedId: string;
  title: string;
  link?: string;
  summary?: string;
  firstSeenAt: string;
  read: boolean;
  tags: string[];
}

export function filterTaggedItems(
  items: TaggedNewsItem[],
  prefs: { mutedTags: string[]; focusTags: string[] },
): TaggedNewsItem[] {
  const muted = new Set(prefs.mutedTags);
  const focus = prefs.focusTags.length ? new Set(prefs.focusTags) : null;
  return items.filter((it) => {
    const visible = it.tags.filter((t) => !muted.has(t));
    if (!visible.length) return false;
    if (!focus) return true;
    return visible.some((t) => focus.has(t));
  });
}

export async function handleNewsRoutes(
  feeds: FeedsStore,
  prefs: NewsPrefsStore,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  readBody: (req: IncomingMessage) => Promise<unknown>,
): Promise<boolean> {
  if (path === "/api/news" && req.method === "GET") {
    const url = new URL(req.url ?? "/", "http://local");
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 80)));
    const q = url.searchParams.get("q") ?? undefined;
    const feedId = url.searchParams.get("feed") ?? undefined;
    const folderId = url.searchParams.get("folder") ?? undefined;
    const unreadOnly = url.searchParams.get("unread") === "1";
    const starred = url.searchParams.get("starred") === "1";
    const items = feeds.list({ limit: 300, q, feedId, folderId, unreadOnly, starred }).map((it) => ({ ...it, tags: tagsForItem(it) }));
    const p = prefs.get();
    const filtered = filterTaggedItems(items, p).slice(0, limit);
    json(res, 200, { tags: TOPIC_TAGS, prefs: p, items: filtered, total: items.length });
    return true;
  }

  if (path === "/api/news/prefs" && req.method === "PUT") {
    const body = (await readBody(req)) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const key of ["mutedTags", "focusTags", "summarizeAutoStarred", "summarizeFolderIds", "summarizeMaxPerHour"] as const) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (!Object.keys(patch).length) throw new ValidationError("provide prefs fields to update");
    const next = await prefs.update(patch as Parameters<NewsPrefsStore["update"]>[0]);
    json(res, 200, { prefs: next });
    return true;
  }

  return false;
}
