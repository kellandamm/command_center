import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { BriefingService } from "./briefing/service";
import { handleAiSecurityRoutes } from "./ai-security/routes";
import type { AiSecurityService } from "./ai-security/service";
import type { DailyBriefingService } from "./daily-briefing/service";
import { handleDailyBriefingRoutes } from "./daily-briefing/routes";
import { llmConfigured, type Config } from "./config";
import { recallioConfigured } from "./recallio/client";
import type { Authenticator } from "./auth";
import { csrfOk, tokenEquals } from "./auth";
import type { FeedsStore } from "./feeds/store";
import type { NotesStore } from "./notes/store";
import { handlePowerAutomateWebhook } from "./integrations/power-automate";
import { handleHobieAgentRoutes } from "./mcp/hobie-routes";
import { handleMcpRoute } from "./mcp/handler";
import type { IntegrationDeps } from "./mcp/actions";
import type { HobieQueueStore } from "./stores/hobie-queue";
import type { PanelUpdatesStore } from "./stores/panel-updates";
import { visibleNavTabs } from "./nav-tabs";
import { panels } from "./panels/registry";
import type { PanelContext } from "./panels/types";
import type { SettingsStore } from "./settings";
import { ValidationError } from "./settings";
import { MANIFEST, SERVICE_WORKER, iconPng } from "./pwa";
import { aiSecurityPage } from "./ui/ai-security-page";
import { dailyBriefingPage } from "./ui/daily-briefing-page";
import { handleNewsRoutes } from "./feeds/news-routes";
import { handleRssRoutes } from "./feeds/rss-routes";
import type { NewsPrefsStore } from "./feeds/news-prefs";
import type { DashboardLayoutStore } from "./dashboard-layout/storage";
import { activityPage } from "./ui/activity-page";
import { calendarPage } from "./ui/calendar-page";
import type { BoardStore } from "./board/store";
import { handleBoardRoutes } from "./board/routes";
import type { WinsStore } from "./wins/store";
import { handleWinsRoutes } from "./wins/routes";
import type { WinsRollupService } from "./wins/rollup-service";
import { boardPage } from "./ui/board-page";
import { winsPage } from "./ui/wins-page";
import { noteToolsPage, notesPage } from "./ui/notes-page";
import { sourceDetailPage, sourcesPage } from "./ui/sources-page";
import { spaceDetailPage, spacesPage } from "./ui/spaces-page";
import { assistantPage } from "./ui/assistant-page";
import { capturePage } from "./ui/capture-page";
import { handleReadLaterRoutes } from "./read-later/routes";
import { ReadLaterService } from "./read-later/service";
import { CaptureAccess } from "./read-later/capture-access";
import { captureExtensionFiles } from "./read-later/extension";
import { zip } from "./read-later/zip";
import { dashboardPage, settingsPage } from "./ui/pages";
import { handleArticleActionRoutes } from "./feeds/article-actions-routes";
import { SummaryService } from "./feeds/summary-service";

export interface App {
  cfg: Config;
  auth: Authenticator;
  settings: SettingsStore;
  feeds: FeedsStore;
  briefing: BriefingService;
  aiSecurity: AiSecurityService;
  dailyBriefing: DailyBriefingService;
  newsPrefs: NewsPrefsStore;
  notes: NotesStore;
  panelUpdates: PanelUpdatesStore;
  hobieQueue: HobieQueueStore;
  board: BoardStore;
  wins: WinsStore;
  winsRollup: WinsRollupService;
  dashboardLayout: DashboardLayoutStore;
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

function bearerToken(req: IncomingMessage): string | undefined {
  const authorization = req.headers.authorization;
  if (!authorization || authorization.slice(0, 6).toLowerCase() !== "bearer") return undefined;
  let tokenStart = 6;
  while (authorization[tokenStart] === " " || authorization[tokenStart] === "\t") tokenStart++;
  return tokenStart > 6 && tokenStart < authorization.length ? authorization.slice(tokenStart) : undefined;
}

/** POST /api/ai-security/roundups may use AI_SECURITY_TOKEN instead of dashboard session auth. */
export function aiSecurityPublishAuthorized(cfg: Config, req: IncomingMessage, path: string, method: string): boolean {
  if (method !== "POST" || path !== "/api/ai-security/roundups") return false;
  const token = bearerToken(req);
  if (!token || !cfg.aiSecurityToken) return false;
  return tokenEquals(token, cfg.aiSecurityToken);
}

export function createApp(app: App): Server {
  const integrationDeps = (): IntegrationDeps => ({
    cfg: app.cfg,
    notes: app.notes,
    panelUpdates: app.panelUpdates,
    hobieQueue: app.hobieQueue,
    board: app.board,
    wins: app.wins,
  });

  const ctx = (): PanelContext => ({
    cfg: app.cfg,
    settings: app.settings,
    feeds: app.feeds,
    briefing: app.briefing,
    notes: app.notes,
    panelUpdates: app.panelUpdates,
    hobieQueue: app.hobieQueue,
    board: app.board,
    wins: app.wins,
  });

  const readLater = new ReadLaterService(app.cfg, app.notes);
  const captureAccess = new CaptureAccess(app.cfg.dataDir);
  const extensionZip = zip(captureExtensionFiles);

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;
      const method = req.method ?? "GET";

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

      if (method === "POST" && path === "/api/capture") {
        const token = bearerToken(req);
        if (token && (await captureAccess.accepts(token))) {
          await handleReadLaterRoutes(app.notes, readLater, captureAccess, req, res, path, (r) => readBody(r, 300_000));
          return;
        }
      }

      const publishOnly = aiSecurityPublishAuthorized(app.cfg, req, path, method);
      const who = publishOnly ? { ok: true as const, who: "ai-security-publish" } : await app.auth(req, url);
      if (!who.ok) return send(res, who.status, `<h1>${who.status}</h1><p>${who.reason}</p>`);
      const extra: Record<string, string> = who.setCookie ? { "set-cookie": who.setCookie } : {};
      if (!csrfOk(req)) return json(res, 403, { error: "cross-site request refused" });
      const get = method === "GET" || method === "HEAD";

      if (get && path === "/manifest.webmanifest") return send(res, 200, MANIFEST, "application/manifest+json", extra);
      if (get && path === "/sw.js") return send(res, 200, SERVICE_WORKER, "text/javascript", { ...extra, "service-worker-allowed": "/" });
      if (get && path === "/icon-192.png") return send(res, 200, icon("192", 192), "image/png", extra);
      if (get && path === "/icon-512.png") return send(res, 200, icon("512", 512), "image/png", extra);
      if (get && path === "/icon-maskable-512.png") return send(res, 200, icon("m512", 512, true), "image/png", extra);

      const nav = () => visibleNavTabs(app.settings.get().sidebarTabs);

      if (get && path === "/") return send(res, 200, dashboardPage(nav()), undefined, extra);
      if (get && path === "/ai-security") return send(res, 200, aiSecurityPage(nav()), undefined, extra);
      if (get && path === "/briefing") return send(res, 200, dailyBriefingPage(nav()), undefined, extra);
      if (get && (path === "/news" || path === "/summaries")) {
        res.writeHead(302, { location: path === "/news" ? "/read-later" : "/library", ...SECURITY, ...extra });
        res.end();
        return;
      }
      if (get && (path === "/read-later" || path === "/library")) return send(res, 200, sourcesPage(nav(), path === "/library"), undefined, extra);
      if (get && /^\/(read-later|library)\/[^/]+$/.test(path)) return send(res, 200, sourceDetailPage(nav()), undefined, extra);
      if (get && path === "/spaces") return send(res, 200, spacesPage(nav()), undefined, extra);
      if (get && /^\/spaces\/[^/]+$/.test(path)) return send(res, 200, spaceDetailPage(nav()), undefined, extra);
      if (get && path === "/assistant") return send(res, 200, assistantPage(nav()), undefined, extra);
      if (get && path === "/settings/capture") return send(res, 200, capturePage(nav()), undefined, extra);
      if (get && path === "/capture-extension.zip") {
        return send(res, 200, extensionZip, "application/zip", { ...extra, "content-disposition": 'attachment; filename="command-center-capture.zip"' });
      }
      if (get && (path === "/notes/connections" || path === "/notes/transfer")) {
        return send(res, 200, noteToolsPage(nav(), path === "/notes/connections"), undefined, extra);
      }
      if (get && path === "/hobie") {
        res.writeHead(302, { location: "/board", ...SECURITY, ...extra });
        res.end();
        return;
      }
      if (get && path === "/board") return send(res, 200, boardPage(nav()), undefined, extra);
      if (get && path === "/wins") return send(res, 200, winsPage(nav()), undefined, extra);
      if (get && path === "/notes") return send(res, 200, notesPage(nav()), undefined, extra);
      if (get && path === "/calendar") return send(res, 200, calendarPage(nav()), undefined, extra);
      if (get && path === "/activity") return send(res, 200, activityPage(nav()), undefined, extra);
      if (get && path === "/settings") return send(res, 200, settingsPage(nav()), undefined, extra);

      if (get && path === "/api/state") {
        return json(res, 200, {
          version: app.cfg.version,
          tz: app.cfg.tz,
          llmEnabled: llmConfigured(app.cfg),
          recallioEnabled: recallioConfigured(app.cfg),
          unread: app.feeds.list({ unreadOnly: true }).length,
          feedCount: app.feeds.feedCount(),
          briefing: app.briefing.get() ?? null,
        });
      }
      if (get && path === "/api/dashboard-layout") return json(res, 200, { layout: app.dashboardLayout.get() });
      if (req.method === "PUT" && path === "/api/dashboard-layout") {
        const layout = await app.dashboardLayout.update(await readBody(req));
        return json(res, 200, { layout });
      }
      if (req.method === "POST" && path === "/api/dashboard-layout/reset") {
        const layout = await app.dashboardLayout.reset();
        return json(res, 200, { layout });
      }

      if (get && path === "/api/settings") return json(res, 200, { settings: app.settings.get() });
      if (req.method === "PUT" && path === "/api/settings") {
        const next = await app.settings.update(await readBody(req));
        return json(res, 200, { settings: next, feedCount: app.feeds.feedCount() });
      }

      if (path.startsWith("/api/capture") || path.startsWith("/api/read-later")) {
        if (await handleReadLaterRoutes(app.notes, readLater, captureAccess, req, res, path, readBody)) return;
      }
      if (await handleAiSecurityRoutes(app.aiSecurity, req, res, path, readBody)) return;
      if (await handleDailyBriefingRoutes(app, app.dailyBriefing, req, res, path)) return;
      if (path.startsWith("/api/board") || path.startsWith("/api/wins")) {
        const bodyForApi = get ? undefined : await readBody(req);
        if (await handleBoardRoutes(app.board, app.hobieQueue, app.wins, app.cfg, req, res, path, bodyForApi)) return;
        if (await handleWinsRoutes(app.wins, app.cfg, app.winsRollup, req, res, path, bodyForApi)) return;
      }
      const summarySvc = new SummaryService(app.cfg, app.feeds, app.feeds.summaries);
      const rssOpts = { cfg: app.cfg, prefs: app.newsPrefs, summaries: summarySvc };
      if (await handleArticleActionRoutes(app.cfg, app.feeds, app.newsPrefs, summarySvc, req, res, path, readBody)) return;
      if (await handleRssRoutes(app.feeds, req, res, path, (r) => readBody(r, path === "/api/rss/opml/import" ? 8_000_000 : 200_000), rssOpts)) return;
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
