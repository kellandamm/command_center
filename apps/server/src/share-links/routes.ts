import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config";
import type { NotesStore } from "../notes/store";
import { ValidationError } from "../settings";
import { sharePageHtml } from "../ui/share-page";
import { shareViewerScript } from "../ui/share-viewer-script";
import { clientIp, ShareLinkRateLimiter } from "./rate-limit";
import { SHARE_LINK_ID_RE, ShareLinksStore } from "./store";

const SECURITY_PUBLIC: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
};

function json(res: ServerResponse, status: number, data: unknown, extra: Record<string, string> = {}) {
  res.writeHead(status, {
    "content-type": "application/json",
    ...SECURITY_PUBLIC,
    ...extra,
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res: ServerResponse, body: string, csp: string) {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    ...SECURITY_PUBLIC,
    "content-security-policy": csp,
  });
  res.end(body);
}

function shareEnabled(cfg: Config): boolean {
  return cfg.shareLinksEnabled;
}

export function parseSharePublicPath(path: string): { id: string; data: boolean } | null {
  const match = path.match(/^\/share\/([A-Za-z0-9_-]{22})(\/data)?$/);
  if (!match) return null;
  const id = match[1]!;
  if (!SHARE_LINK_ID_RE.test(id)) return null;
  return { id, data: match[2] === "/data" };
}

export async function handleSharePublicRoutes(
  cfg: Config,
  store: ShareLinksStore,
  rateLimiter: ShareLinkRateLimiter,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<boolean> {
  if (!shareEnabled(cfg)) return false;

  const method = req.method ?? "GET";

  if (path === "/assets/share-viewer.js" && (method === "GET" || method === "HEAD")) {
    if (!rateLimiter.allow(clientIp(req.headers))) {
      json(res, 429, { error: "rate limit exceeded" });
      return true;
    }
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      ...SECURITY_PUBLIC,
      "content-security-policy": "default-src 'none'",
    });
    res.end(method === "HEAD" ? "" : shareViewerScript());
    return true;
  }

  if (path.startsWith("/share/")) {
    const parsed = parseSharePublicPath(path);
    if (!parsed) {
      json(res, 404, { error: "not found" });
      return true;
    }
    return serveSharePublic(store, rateLimiter, req, res, method, parsed);
  }

  return false;
}

function serveSharePublic(
  store: ShareLinksStore,
  rateLimiter: ShareLinkRateLimiter,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  parsed: { id: string; data: boolean },
): boolean {

  if (!["GET", "HEAD"].includes(method)) {
    json(res, 405, { error: "method not allowed" });
    return true;
  }

  if (!rateLimiter.allow(clientIp(req.headers))) {
    json(res, 429, { error: "rate limit exceeded" });
    return true;
  }

  const link = store.get(parsed.id);
  if (!link) {
    json(res, 404, { error: "not found" });
    return true;
  }

  if (parsed.data) {
    json(res, 200, { ciphertext: link.ciphertext, iv: link.iv });
    return true;
  }

  const nonce = randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "connect-src 'self'",
    "img-src 'self' data:",
    `style-src 'nonce-${nonce}'`,
    "script-src 'self'",
  ].join("; ");
  sendHtml(res, sharePageHtml(parsed.id, nonce), csp);
  return true;
}

async function readJsonBody(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    body += chunk.toString();
    if (Buffer.byteLength(body, "utf8") > limit) throw new ValidationError("request body too large");
  }
  try {
    const parsed = JSON.parse(body || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("body must be an object");
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SyntaxError) throw new ValidationError("invalid JSON");
    throw new ValidationError(err instanceof Error ? err.message : "invalid request");
  }
}

function noteIsSensitive(note: { sensitive?: boolean }): boolean {
  return note.sensitive === true;
}

export async function handleShareOwnerRoutes(
  cfg: Config,
  notes: NotesStore,
  store: ShareLinksStore,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  owner: boolean,
): Promise<boolean> {
  if (!shareEnabled(cfg)) return false;

  const jsonOwner = (status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  };

  if (path === "/api/knowledge/share-links" && req.method === "GET") {
    if (!owner) return jsonOwner(403, { error: "owner login required" }), true;
    const links = store.list().map(({ id, noteId, expiresAt, createdAt }) => ({ id, noteId, expiresAt, createdAt }));
    jsonOwner(200, { links });
    return true;
  }

  const revokeMatch = path.match(/^\/api\/knowledge\/share-links\/([A-Za-z0-9_-]{22})$/);
  if (revokeMatch && req.method === "DELETE") {
    if (!owner) return jsonOwner(403, { error: "owner login required" }), true;
    const id = revokeMatch[1]!;
    if (!SHARE_LINK_ID_RE.test(id)) return jsonOwner(400, { error: "invalid share id" }), true;
    const removed = await store.revoke(id);
    if (!removed) return jsonOwner(404, { error: "not found" }), true;
    jsonOwner(200, { ok: true });
    return true;
  }

  const createMatch = path.match(/^\/api\/knowledge\/notes\/([^/]+)\/share-links$/);
  if (createMatch && req.method === "POST") {
    if (!owner) return jsonOwner(403, { error: "owner login required" }), true;
    let noteId: string;
    try {
      noteId = decodeURIComponent(createMatch[1]!);
    } catch {
      return jsonOwner(400, { error: "invalid note id" }), true;
    }
    const note = notes.getNote(noteId);
    if (!note) return jsonOwner(404, { error: "note not found" }), true;
    if (noteIsSensitive(note)) {
      return jsonOwner(403, { error: "sensitive notes cannot be shared" }), true;
    }
    const body = await readJsonBody(req, cfg.shareLinksMaxCiphertextBytes + 4096);
    const ciphertext = typeof body.ciphertext === "string" ? body.ciphertext : "";
    const iv = typeof body.iv === "string" ? body.iv : "";
    const expiresInSeconds = typeof body.expiresInSeconds === "number" ? body.expiresInSeconds : 86_400;
    try {
      const created = await store.create({
        noteId,
        ciphertext,
        iv,
        expiresInSeconds: expiresInSeconds as 3600 | 86_400 | 604_800,
        maxActive: cfg.shareLinksMaxActive,
        maxCiphertextBytes: cfg.shareLinksMaxCiphertextBytes,
      });
      jsonOwner(201, { id: created.id, expiresAt: created.expiresAt });
    } catch (err) {
      if (err instanceof ValidationError) return jsonOwner(400, { error: err.message }), true;
      throw err;
    }
    return true;
  }

  return false;
}

/** Test helper: confirm persisted file has no decryptable plaintext for a snapshot title. */
export function shareStoreLooksEncrypted(raw: string, forbiddenPlaintext: string): boolean {
  if (raw.includes(forbiddenPlaintext)) return false;
  return !raw.includes('"title"') || !raw.includes('"html"');
}
