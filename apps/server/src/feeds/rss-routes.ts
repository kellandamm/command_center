import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config";
import { llmConfigured } from "../config";
import { recallioConfigured } from "../recallio/client";
import { assertPublicUrl, BlockedUrlError } from "../ssrf";
import type { NewsPrefsStore } from "./news-prefs";
import { pollDueFeeds } from "./poller";
import type { SummaryService } from "./summary-service";
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
  opts?: { cfg?: Config; prefs?: NewsPrefsStore; summaries?: SummaryService },
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
    const summary = feeds.summaries.findByEntryId(item.id);
    json(res, 200, {
      item,
      summary: summary ?? null,
      recallioEnabled: opts?.cfg ? recallioConfigured(opts.cfg) : false,
      llmEnabled: opts?.cfg ? llmConfigured(opts.cfg) : false,
    });
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
    const starred = body.starred !== false;
    const ok = feeds.setStarred(body.id, starred);
    if (ok && starred && opts?.summaries && opts.prefs) {
      await opts.summaries.maybeAutoSummarize(body.id, opts.prefs.get());
    }
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

  const patchFeed = path.match(/^\/api\/rss\/feeds\/([^/]+)$/);
  if (patchFeed && req.method === "PATCH") {
    const body = (await readBody(req)) as { folderId?: string | null };
    if (body.folderId === undefined) throw new ValidationError("folderId required (use null for ungrouped)");
    const ok = feeds.moveFeed(decodeURIComponent(patchFeed[1]!), body.folderId);
    await feeds.save();
    json(res, 200, { ok });
    return true;
  }

  if (path === "/api/rss/folders" && req.method === "POST") {
    const body = (await readBody(req)) as { name?: string; parentId?: string | null };
    if (!body.name?.trim()) throw new ValidationError("name required");
    const created = feeds.createFolder(body.name.trim(), body.parentId ?? null);
    await feeds.save();
    json(res, 200, created);
    return true;
  }

  const folderRoute = path.match(/^\/api\/rss\/folders\/([^/]+)$/);
  if (folderRoute && req.method === "PATCH") {
    const body = (await readBody(req)) as { name?: string };
    if (!body.name?.trim()) throw new ValidationError("name required");
    const ok = feeds.renameFolder(decodeURIComponent(folderRoute[1]!), body.name.trim());
    await feeds.save();
    json(res, 200, { ok });
    return true;
  }
  if (folderRoute && req.method === "DELETE") {
    const ok = feeds.deleteFolder(decodeURIComponent(folderRoute[1]!));
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
    const onNew =
      opts?.summaries && opts.prefs
        ? async (ids: string[]) => {
            const p = opts.prefs!.get();
            for (const id of ids) await opts.summaries!.maybeAutoSummarize(id, p);
          }
        : undefined;
    const results = await pollDueFeeds(feeds, new Date(), undefined, onNew);
    await feeds.save();
    json(res, 200, { results });
    return true;
  }

  return false;
}
