import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config";
import { authenticateBookmarksImport } from "../mcp/auth";
import { ValidationError } from "../settings";
import type { XBookmarksService } from "./x-bookmarks-service";
import { xBookmarkImportBodySchema, type XBookmarksStore } from "./x-bookmarks-store";

export function isXBookmarkImportPayload(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && !Array.isArray(body) && Array.isArray((body as { items?: unknown }).items));
}

export async function handleXBookmarkImport(
  cfg: Config,
  store: XBookmarksStore,
  service: XBookmarksService,
  req: IncomingMessage,
  res: ServerResponse,
  rawBody: Buffer,
): Promise<void> {
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  };
  if (!cfg.bookmarksImportSecret) {
    json(404, { error: "Bookmarks import is not configured" });
    return;
  }
  const auth = await authenticateBookmarksImport(cfg, req);
  if (!auth.ok) {
    json(auth.status, { error: auth.reason });
    return;
  }
  if (req.method !== "POST") {
    json(405, { error: "method not allowed" });
    return;
  }
  let body: unknown;
  try {
    body = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
  } catch {
    json(400, { error: "invalid JSON" });
    return;
  }
  if (!isXBookmarkImportPayload(body)) {
    json(400, { error: "body must include items[]" });
    return;
  }
  try {
    const parsed = xBookmarkImportBodySchema.parse(body);
    const result = await store.importItems(parsed.items);
    if (result.imported) service.enqueue();
    json(200, result);
  } catch (err) {
    if (err instanceof ValidationError) json(400, { error: err.message });
    else throw err;
  }
}

export async function handleXBookmarkApiRoutes(
  store: XBookmarksStore,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  readBody: (req: IncomingMessage) => Promise<unknown>,
): Promise<boolean> {
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  };
  if (path === "/api/x-bookmarks" && req.method === "GET") {
    json(200, { items: store.list() });
    return true;
  }
  const read = path.match(/^\/api\/x-bookmarks\/([^/]+)\/read$/);
  if (read && req.method === "POST") {
    const postId = decodeURIComponent(read[1]!);
    const item = await store.markRead(postId);
    if (!item) json(404, { error: "bookmark not found" });
    else json(200, { item });
    return true;
  }
  if (path === "/api/x-bookmarks/read-all" && req.method === "POST") {
    const body = (await readBody(req)) as { post_ids?: unknown };
    const ids = Array.isArray(body?.post_ids) ? body.post_ids.map(String) : [];
    for (const postId of ids) await store.markRead(postId);
    json(200, { ok: true });
    return true;
  }
  return false;
}
