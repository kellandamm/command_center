import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { BriefingService } from "./briefing/service";
import { llmConfigured, type Config } from "./config";
import { recallioConfigured } from "./recallio/client";
import type { Authenticator } from "./auth";
import { csrfOk } from "./auth";
import type { FeedsStore } from "./feeds/store";
import type { NotesStore } from "./notes/store";
import { handlePowerAutomateWebhook } from "./integrations/power-automate";
import { handleHobieAgentRoutes } from "./mcp/hobie-routes";
import { handleMcpRoute } from "./mcp/handler";
import type { IntegrationDeps } from "./mcp/actions";
import type { HobieQueueStore } from "./stores/hobie-queue";
import type { PanelUpdatesStore } from "./stores/panel-updates";
import { parseFeedList } from "./feeds/parse";
import { panels } from "./panels/registry";
import type { PanelContext } from "./panels/types";
import type { SettingsStore } from "./settings";
import { ValidationError } from "./settings";
import { MANIFEST, SERVICE_WORKER, iconPng } from "./pwa";
import { handleNewsRoutes } from "./feeds/news-routes";
import type { NewsPrefsStore } from "./feeds/news-prefs";
import { dashboardPage, settingsPage } from "./ui/pages";
import { newsPage } from "./ui/news-page";

export interface App {
  cfg: Config;
  auth: Authenticator;
  settings: SettingsStore;
  feeds: FeedsStore;
  briefing: BriefingService;
  newsPrefs: NewsPrefsStore;
  notes: NotesStore;
  panelUpdates: PanelUpdatesStore;
  hobieQueue: HobieQueueStore;
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
  const integrationDeps = (): IntegrationDeps => ({
    cfg: app.cfg,
    notes: app.notes,
    panelUpdates: app.panelUpdates,
    hobieQueue: app.hobieQueue,
  });

  const ctx = (): PanelContext => ({
    cfg: app.cfg,
    settings: app.settings,
    feeds: app.feeds,
    briefing: app.briefing,
    notes: app.notes,
    panelUpdates: app.panelUpdates,
    hobieQueue: app.hobieQueue,
  });

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;

      if (path === "/healthz") return json(res, 200, { ok: true, version: app.cfg.version });

      if (path === "/mcp") {
        const body = req.method === "POST" ? await readBody(req, 1_000_000) : undefined;
        await handleMcpRoute(integrationDeps(), req, res, body);
        return;
      }

      if (path === "/api/webhooks/power-automate") {
        const body = await readBody(req);
        await handlePowerAutomateWebhook(integrationDeps(), req, res, body);
        return;
      }

      if (path === "/api/hobie/tasks" || path === "/api/hobie/claim") {
        const body = req.method === "POST" ? await readBody(req) : undefined;
        await handleHobieAgentRoutes(app.cfg, app.hobieQueue, req, res, path, body);
        return;
      }

      const who = await app.auth(req, url);
      if (!who.ok) return send(res, who.status, `<h1>${who.status}</h1><p>${who.reason}</p>`);
      const extra: Record<string, string> = who.setCookie ? { "set-cookie": who.setCookie } : {};
      if (!csrfOk(req)) return json(res, 403, { error: "cross-site request refused" });
      const get = req.method === "GET" || req.method === "HEAD";

      if (get && path === "/manifest.webmanifest") return send(res, 200, MANIFEST, "application/manifest+json", extra);
      if (get && path === "/sw.js") return send(res, 200, SERVICE_WORKER, "text/javascript", { ...extra, "service-worker-allowed": "/" });
      if (get && path === "/icon-192.png") return send(res, 200, icon("192", 192), "image/png", extra);
      if (get && path === "/icon-512.png") return send(res, 200, icon("512", 512), "image/png", extra);
      if (get && path === "/icon-maskable-512.png") return send(res, 200, icon("m512", 512, true), "image/png", extra);

      if (get && path === "/") return send(res, 200, dashboardPage(), undefined, extra);
      if (get && path === "/news") return send(res, 200, newsPage(), undefined, extra);
      if (get && path === "/settings") return send(res, 200, settingsPage(), undefined, extra);

      if (get && path === "/api/state") {
        const parsed = parseFeedList(app.settings.get().feeds);
        return json(res, 200, {
          version: app.cfg.version,
          tz: app.cfg.tz,
          llmEnabled: llmConfigured(app.cfg),
          recallioEnabled: recallioConfigured(app.cfg),
          unread: app.feeds.list({ unreadOnly: true }).length,
          feedCount: parsed.feeds.length,
          briefing: app.briefing.get() ?? null,
        });
      }
      if (get && path === "/api/settings") return json(res, 200, { settings: app.settings.get() });
      if (req.method === "PUT" && path === "/api/settings") {
        const next = await app.settings.update(await readBody(req));
        const parsed = parseFeedList(next.feeds);
        return json(res, 200, { settings: next, feedCount: parsed.feeds.length, feedErrors: parsed.errors });
      }

      if (await handleNewsRoutes(app.feeds, app.newsPrefs, req, res, path, readBody)) return;

      for (const panel of panels) {
        if (panel.handle && (await panel.handle(ctx(), req, res, path))) return;
      }

      return json(res, 404, { error: "not found" });
    } catch (err) {
      if (err instanceof ValidationError) return json(res, 400, { error: err.message });
      console.error("request failed:", err);
      return json(res, 500, { error: "internal error" });
    }
  });
}
