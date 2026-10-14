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
    const limit = 80;
    const items = feeds.list({ limit: 200 }).map((it) => ({ ...it, tags: tagsForItem(it) }));
    const p = prefs.get();
    const filtered = filterTaggedItems(items, p).slice(0, limit);
    json(res, 200, { tags: TOPIC_TAGS, prefs: p, items: filtered, total: items.length });
    return true;
  }

  if (path === "/api/news/prefs" && req.method === "PUT") {
    const body = (await readBody(req)) as Record<string, unknown>;
    const patch: { mutedTags?: string[]; focusTags?: string[] } = {};
    if (body.mutedTags !== undefined) patch.mutedTags = body.mutedTags as string[];
    if (body.focusTags !== undefined) patch.focusTags = body.focusTags as string[];
    if (!patch.mutedTags && !patch.focusTags) throw new ValidationError("provide mutedTags and/or focusTags");
    const next = await prefs.update(patch);
    json(res, 200, { prefs: next });
    return true;
  }

  return false;
}
