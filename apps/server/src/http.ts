import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config";
import type { Authenticator } from "./auth";
import { csrfOk } from "./auth";
import type { BuildManager } from "./build";
import type { SettingsStore } from "./settings";
import { ValidationError } from "./settings";
import { parseSources } from "./sources";
import { EDITION_ID, spendTotals, type EditionStore, type Ledger } from "./store";
import { MANIFEST, SERVICE_WORKER, iconPng } from "./pwa";
import { archivePage, emptyPage, extensionPage, settingsPage, statusPage, viewerPage } from "./ui/pages";

export interface App {
  cfg: Config;
  auth: Authenticator;
  manager: BuildManager;
  settings: SettingsStore;
  editions: EditionStore;
  ledger: Ledger;
}

const SECURITY: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function send(res: ServerResponse, status: number, body: string | Buffer, type = "text/html; charset=utf-8", extra: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...SECURITY, ...extra });
  res.end(body);
}
const json = (res: ServerResponse, status: number, data: unknown) => send(res, status, JSON.stringify(data), "application/json");

async function readBody(req: IncomingMessage, limit = 200_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new ValidationError("request body too large");
    chunks.push(c as Buffer);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ValidationError("invalid JSON");
  }
}

const icons = new Map<string, Buffer>();
const icon = (name: string, size: number, maskable = false) => icons.get(name) ?? (icons.set(name, iconPng(size, maskable)), icons.get(name)!);

export function createApp(app: App): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;

      // Liveness only: no data, no auth, so a container healthcheck needs no credentials.
      if (path === "/healthz") return json(res, 200, { ok: true, version: app.cfg.version });

      const who = await app.auth(req, url);
      if (!who.ok) return send(res, who.status, `<h1>${who.status}</h1><p>${who.reason}</p>`);
      const extra: Record<string, string> = who.setCookie ? { "set-cookie": who.setCookie } : {};
      if (!csrfOk(req)) return json(res, 403, { error: "cross-site request refused" });
      const get = req.method === "GET" || req.method === "HEAD";

      // ---- PWA files
      if (get && path === "/manifest.webmanifest") return send(res, 200, MANIFEST, "application/manifest+json", extra);
      if (get && path === "/sw.js") return send(res, 200, SERVICE_WORKER, "text/javascript", { ...extra, "service-worker-allowed": "/" });
      if (get && path === "/icon-192.png") return send(res, 200, icon("192", 192), "image/png", extra);
      if (get && path === "/icon-512.png") return send(res, 200, icon("512", 512), "image/png", extra);
      if (get && path === "/icon-maskable-512.png") return send(res, 200, icon("m512", 512, true), "image/png", extra);

      // ---- pages
      if (get && path === "/") {
        const latest = await app.editions.latest();
        return send(res, 200, latest ? viewerPage(latest) : emptyPage(!!app.cfg.anthropicApiKey), undefined, extra);
      }
      if (get && path === "/archive") return send(res, 200, archivePage(await app.editions.list(), app.cfg.tz), undefined, extra);
      if (get && path === "/status") return send(res, 200, statusPage(), undefined, extra);
      if (get && path === "/settings") return send(res, 200, settingsPage(), undefined, extra);
      if (get && path === "/extension") return send(res, 200, extensionPage(!!zipPath(app.cfg)), undefined, extra);
      if (get && path === "/extension.zip") {
        const zip = zipPath(app.cfg);
        if (!zip) return json(res, 404, { error: "no extension bundle in this image" });
        res.writeHead(200, { "content-type": "application/zip", "content-length": statSync(zip).size, "content-disposition": 'attachment; filename="ai-homepage-extension.zip"', ...SECURITY });
        return void createReadStream(zip).pipe(res);
      }

      const ed = path.match(/^\/e\/([^/]+)(\/doc)?$/);
      if (get && ed) {
        const id = ed[1]!;
        if (!EDITION_ID.test(id)) return json(res, 404, { error: "not found" });
        if (ed[2]) {
          const doc = await app.editions.doc(id);
          if (!doc) return json(res, 404, { error: "not found" });
          // Even if someone opens the document URL directly, it runs in an opaque origin.
          return send(res, 200, doc, "text/html; charset=utf-8", { "content-security-policy": "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox", ...extra });
        }
        const meta = await app.editions.meta(id);
        return meta ? send(res, 200, viewerPage(meta), undefined, extra) : json(res, 404, { error: "not found" });
      }

      // ---- API
      if (get && path === "/api/state") {
        const s = app.settings.get();
        const t = spendTotals(await app.ledger.all(), new Date(), app.cfg.tz);
        return json(res, 200, {
          version: app.cfg.version, tz: app.cfg.tz, hasKey: !!app.cfg.anthropicApiKey,
          build: app.manager.status(),
          spend: { today: t.today, month: t.thisMonth, buildsToday: t.buildsToday, caps: s.caps },
          latest: (await app.editions.latest())?.id ?? null,
        });
      }
      if (get && path === "/api/settings") return json(res, 200, { settings: app.settings.get() });
      if (req.method === "PUT" && path === "/api/settings") {
        const next = await app.settings.update(await readBody(req));
        const parsed = parseSources(next.sources);
        return json(res, 200, { settings: next, sourceCount: parsed.sources.length, sourceErrors: parsed.errors });
      }
      if (req.method === "POST" && path === "/api/build") {
        const r = await app.manager.start("manual");
        return json(res, r.ok ? 202 : r.code === "busy" ? 409 : 400, r.ok ? r : { error: r.reason, code: r.code });
      }
      if (req.method === "POST" && path === "/api/cancel") return json(res, 200, { cancelled: app.manager.cancel() });
      const del = path.match(/^\/api\/editions\/([^/]+)\/delete$/);
      if (req.method === "POST" && del) {
        if (!EDITION_ID.test(del[1]!)) return json(res, 404, { error: "not found" });
        await app.editions.remove(del[1]!);
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { error: "not found" });
    } catch (err) {
      if (err instanceof ValidationError) return json(res, 400, { error: err.message });
      console.error("request failed:", err);
      return json(res, 500, { error: "internal error" });
    }
  });
}

function zipPath(cfg: Config): string | null {
  if (!cfg.publicDir) return null;
  const p = join(cfg.publicDir, "extension.zip");
  return existsSync(p) ? p : null;
}
