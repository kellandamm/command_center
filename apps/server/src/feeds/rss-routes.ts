import type { IncomingMessage, ServerResponse } from "node:http";
import { assertPublicUrl, BlockedUrlError } from "../ssrf";
import { pollDueFeeds } from "./poller";
import type { FeedsStore } from "./store";
import { ValidationError } from "../settings";

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

export async function handleRssRoutes(
  feeds: FeedsStore,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  readBody: (req: IncomingMessage) => Promise<unknown>,
): Promise<boolean> {
  if (path === "/api/rss/tree" && req.method === "GET") {
    json(res, 200, { tree: feeds.tree(), searchMode: feeds.usesFts5() ? "fts5" : "like" });
    return true;
  }

  if (path === "/api/rss/entries" && req.method === "GET") {
    const url = new URL(req.url ?? "/", "http://local");
    const q = url.searchParams.get("q") ?? undefined;
    const feedId = url.searchParams.get("feed") ?? undefined;
    const folderId = url.searchParams.get("folder") ?? undefined;
    const unreadOnly = url.searchParams.get("unread") === "1";
    const starred = url.searchParams.get("starred") === "1";
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 80)));
    const items = feeds.list({ q, feedId, folderId, unreadOnly, starred, limit });
    json(res, 200, { items });
    return true;
  }

  const entryMatch = path.match(/^\/api\/rss\/entries\/([^/]+)$/);
  if (entryMatch && req.method === "GET") {
    const item = feeds.getEntry(decodeURIComponent(entryMatch[1]!));
    if (!item) {
      json(res, 404, { error: "not found" });
      return true;
    }
    json(res, 200, { item });
    return true;
  }

  if (path === "/api/rss/read" && req.method === "POST") {
    const body = (await readBody(req)) as { ids?: string[] };
    const n = feeds.markRead(body.ids ?? []);
    await feeds.save();
    json(res, 200, { marked: n });
    return true;
  }

  if (path === "/api/rss/read-all" && req.method === "POST") {
    const body = (await readBody(req)) as { feedId?: string; folderId?: string };
    const n = feeds.markAllRead({ feedId: body.feedId, folderId: body.folderId });
    await feeds.save();
    json(res, 200, { marked: n });
    return true;
  }

  if (path === "/api/rss/star" && req.method === "POST") {
    const body = (await readBody(req)) as { id?: string; starred?: boolean };
    if (!body.id) throw new ValidationError("id required");
    const ok = feeds.setStarred(body.id, body.starred !== false);
    await feeds.save();
    json(res, 200, { ok });
    return true;
  }

  if (path === "/api/rss/feeds" && req.method === "POST") {
    const body = (await readBody(req)) as { xmlUrl?: string; title?: string; folderId?: string };
    if (!body.xmlUrl?.trim()) throw new ValidationError("xmlUrl required");
    try {
      await assertPublicUrl(body.xmlUrl.trim());
    } catch (err) {
      throw new ValidationError(err instanceof BlockedUrlError ? err.message : "invalid feed URL");
    }
    const added = feeds.addFeed({ xmlUrl: body.xmlUrl.trim(), title: body.title, folderId: body.folderId ?? null });
    await feeds.save();
    json(res, 200, added);
    return true;
  }

  const delFeed = path.match(/^\/api\/rss\/feeds\/([^/]+)$/);
  if (delFeed && req.method === "DELETE") {
    const ok = feeds.removeFeed(decodeURIComponent(delFeed[1]!));
    await feeds.save();
    json(res, 200, { removed: ok });
    return true;
  }

  if (path === "/api/rss/opml/import" && req.method === "POST") {
    const body = (await readBody(req)) as { xml?: string; replace?: boolean };
    if (!body.xml || typeof body.xml !== "string") throw new ValidationError("xml required");
    const stats = feeds.importOpml(body.xml, { replace: !!body.replace });
    await feeds.save();
    json(res, 200, stats);
    return true;
  }

  if (path === "/api/rss/opml/export" && req.method === "GET") {
    const xml = feeds.exportOpmlDocument();
    res.writeHead(200, {
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": 'attachment; filename="feeds.opml"',
      "cache-control": "no-store",
    });
    res.end(xml);
    return true;
  }

  if (path === "/api/rss/poll" && req.method === "POST") {
    const results = await pollDueFeeds(feeds);
    await feeds.save();
    json(res, 200, { results });
    return true;
  }

  return false;
}
