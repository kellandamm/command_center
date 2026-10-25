import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { DailyBriefingService } from "./daily-briefing/service";
import { handleDailyBriefingRoutes } from "./daily-briefing/routes";
import { llmConfigured, type Config } from "./config";
import { accessJwtFromRequest } from "./cf-access";
import { recallioConfigured } from "./recallio/client";
import type { Authenticator } from "./auth";
import { bearerToken, csrfOk } from "./auth";
import type { NotesStore } from "./notes/store";
import { NoteConflictError } from "./notes/store";
import type { BookmarksStore } from "./bookmarks/store";
import { bookmarksPage } from "./ui/bookmarks-page";
import { handlePowerAutomateWebhook } from "./integrations/power-automate";
import { handleHobieAgentRoutes } from "./mcp/hobie-routes";
import { handleMcpRoute } from "./mcp/handler";
import type { IntegrationDeps } from "./mcp/actions";
import type { HobieQueueStore } from "./stores/hobie-queue";
import type { AgentTaskQueueStore } from "./stores/agent-task-queue";
import type { AgentApprovalsStore } from "./stores/agent-approvals";
import {
  handleAgentApprovalRoutes,
  handleAgentQueueOwnerApi,
  handleAgentQueueRoutes,
} from "./queue/routes";
import { QueueNonceStore } from "./queue/nonce-store";
import { QUEUE_HMAC_WINDOW_SEC } from "./queue/hmac";
import type { PanelUpdatesStore } from "./stores/panel-updates";
import { visibleNavTabs } from "./nav-tabs";
import { panels } from "./panels/registry";
import type { PanelContext } from "./panels/types";
import type { SettingsStore } from "./settings";
import { ValidationError } from "./settings";
import { MANIFEST, SERVICE_WORKER, iconPng } from "./pwa";
import { dailyBriefingPage } from "./ui/daily-briefing-page";
import type { DashboardLayoutStore } from "./dashboard-layout/storage";
import { activityPage } from "./ui/activity-page";
import { calendarPage } from "./ui/calendar-page";
import type { BoardStore } from "./board/store";
import { handleBoardRoutes } from "./board/routes";
import type { WinsStore } from "./wins/store";
import { handleWinsRoutes } from "./wins/routes";
import type { WinsRollupService } from "./wins/rollup-service";
import { boardPage } from "./ui/board-page";
import { agentQueuePage } from "./ui/agent-queue-page";
import { winsPage } from "./ui/wins-page";
import { noteToolsPage, notesPage } from "./ui/notes-page";
import { sourceDetailPage, sourcesPage } from "./ui/sources-page";
import { spaceDetailPage, spacesPage } from "./ui/spaces-page";
import { assistantPage } from "./ui/assistant-page";
import { capturePage } from "./ui/capture-page";
import { handleReadLaterRoutes } from "./read-later/routes";
import { ReadLaterService } from "./read-later/service";
import { CaptureAccess } from "./read-later/capture-access";
import { handleMeetingImportRoute } from "./meetings/routes";
import { handleXBookmarkApiRoutes, handleXBookmarkImport, isXBookmarkImportPayload } from "./read-later/x-bookmarks-routes";
import type { XBookmarksService } from "./read-later/x-bookmarks-service";
import type { XBookmarksStore } from "./read-later/x-bookmarks-store";
import { captureExtensionFiles } from "./read-later/extension";
import { zip } from "./read-later/zip";
import { dashboardPage, settingsPage } from "./ui/pages";
import type { AttentionStore } from "./attention/store";
import type { LaunchpadStore } from "./launchpad/store";
import type { FocusSessionsStore } from "./focus/store";
import { OWNER_ACTION_FORBIDDEN, canManageSharedServerState, computeOwnerReason } from "./owner-auth";
import { connectionProvider, type ConnectionsStore } from "./connections";
import { connectionsPage } from "./ui/connections-page";
import { notesEditorScript } from "./ui/notes-editor-asset";
import type { CalendarWorkspace } from "./calendar/workspace";
import { CalendarConflictError } from "./calendar/store";
import { handleCalendarRoutes } from "./calendar/routes";
import { handleQuickAddRoutes } from "./quick-add/routes";
import type { VoiceCaptureStore } from "./voice-capture/store";
import { handleVoiceCaptureIngest, handleVoiceCaptureOwnerRoutes, voiceCaptureUnauthorized } from "./voice-capture/routes";
import { exportCalendar } from "./calendar/export";
import { calendarSettingsPage } from "./ui/calendar-settings-page";
import { calendarEventPage } from "./ui/calendar-event-page";
import { ShareLinksStore } from "./share-links/store";
import { ShareLinkRateLimiter } from "./share-links/rate-limit";
import { handleShareOwnerRoutes, handleSharePublicRoutes } from "./share-links/routes";
import { WhiteboardStore } from "./whiteboard/store";
import { handleWhiteboardRoutes } from "./whiteboard/routes";
import { excalidrawAssetContentType, readExcalidrawAsset } from "./whiteboard/assets";
import { whiteboardPage } from "./ui/whiteboard-page";
import { whiteboardEditorScript } from "./ui/whiteboard-editor-asset";
import { readBody, readRawBody } from "./request-body";
import { notify, ntfyStatus, resolveNtfyConfig } from "./notify/ntfy";

export interface App {
  cfg: Config;
  /** Deployment env defaults (env wins over connection vault for ntfy). */
  deployment?: Config;
  auth: Authenticator;
  settings: SettingsStore;
  dailyBriefing: DailyBriefingService;
  notes: NotesStore;
  bookmarks: BookmarksStore;
  xBookmarks: XBookmarksStore;
  xBookmarksService: XBookmarksService;
  panelUpdates: PanelUpdatesStore;
  hobieQueue: HobieQueueStore;
  agentTaskQueue: AgentTaskQueueStore;
  agentApprovals: AgentApprovalsStore;
  board: BoardStore;
  wins: WinsStore;
  winsRollup: WinsRollupService;
  dashboardLayout: DashboardLayoutStore;
  attention: AttentionStore;
  launchpad: LaunchpadStore;
  focusSessions: FocusSessionsStore;
  whiteboard: WhiteboardStore;
  connections?: ConnectionsStore;
  calendar?: CalendarWorkspace;
  shareLinks: ShareLinksStore;
  voiceCaptures: VoiceCaptureStore;
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

const icons = new Map<string, Buffer>();
const icon = (name: string, size: number, maskable = false) => icons.get(name) ?? (icons.set(name, iconPng(size, maskable)), icons.get(name)!);

export function createApp(app: App): Server {
  const deployment = app.deployment ?? app.cfg;
  const integrationDeps = (): IntegrationDeps => ({
    cfg: app.cfg,
    notes: app.notes,
    panelUpdates: app.panelUpdates,
    hobieQueue: app.hobieQueue,
    board: app.board,
    wins: app.wins,
  });

  const ctx = (owner: boolean): PanelContext => ({
    cfg: app.cfg,
    settings: app.settings,
    calendar: app.calendar,
    notes: app.notes,
    panelUpdates: app.panelUpdates,
    hobieQueue: app.hobieQueue,
    board: app.board,
    wins: app.wins,
    attention: app.attention,
    launchpad: app.launchpad,
    focusSessions: app.focusSessions,
    owner,
  });

  const readLater = new ReadLaterService(app.cfg, app.notes);
  const captureAccess = new CaptureAccess(app.cfg.dataDir);
  const extensionZip = zip(captureExtensionFiles);
  const queueNonces = new QueueNonceStore(QUEUE_HMAC_WINDOW_SEC * 1000);
  const shareLinkRateLimiter = new ShareLinkRateLimiter(app.cfg.shareLinksRateLimitPerMinute);
  app.xBookmarksService.start();

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (path === "/healthz") return json(res, 200, { ok: true, version: app.cfg.version });
      const feed = path.match(/^\/feeds\/calendars\/([a-zA-Z0-9-]+)\.ics$/);
      if (feed) {
        const key = url.searchParams.get("key") ?? "";
        if (!["GET", "HEAD"].includes(method) || !app.calendar || key.length !== 64 || !app.calendar.store.published(feed[1]!, key)) return json(res, 404, { error: "Feed not found or access revoked" });
        return send(res, 200, method === "HEAD" ? "" : exportCalendar(app.calendar.store, feed[1]!), "text/calendar; charset=utf-8");
      }

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

      if (path === "/api/bookmarks/import" && method === "POST") {
        const raw = await readRawBody(req, 512_000);
        let preview: unknown;
        try {
          preview = raw.length ? JSON.parse(raw.toString("utf8")) : {};
        } catch {
          return json(res, 400, { error: "invalid JSON" });
        }
        if (isXBookmarkImportPayload(preview)) {
          await handleXBookmarkImport(app.cfg, app.xBookmarks, app.xBookmarksService, req, res, raw);
          return;
        }
        if (accessJwtFromRequest(req.headers)) {
          return json(res, 400, { error: "body must include items[] for X bookmarks import" });
        }
        // fall through: browser bookmark file import uses session auth below
        (req as IncomingMessage & { __bookmarkImportBody?: unknown }).__bookmarkImportBody = preview;
      }

      if (path === "/api/hobie/tasks" || path === "/api/hobie/claim") {
        const body = req.method === "POST" ? await readBody(req) : undefined;
        await handleHobieAgentRoutes(app.cfg, app.hobieQueue, req, res, path, body);
        return;
      }

      if (path.startsWith("/api/queue")) {
        const handled = await handleAgentQueueRoutes(
          app.cfg,
          app.agentTaskQueue,
          app.agentApprovals,
          queueNonces,
          req,
          res,
          path,
        );
        if (handled) return;
      }

      if (method === "POST" && path === "/api/capture") {
        const token = bearerToken(req);
        if (token && (await captureAccess.accepts(token))) {
          await handleReadLaterRoutes(app.notes, readLater, captureAccess, req, res, path, (r) => readBody(r, 300_000));
          return;
        }
      }

      if (method === "POST" && path === "/api/meetings/import") {
        await handleMeetingImportRoute(app.cfg, app.notes, req, res);
        return;
      }

      if (method === "POST" && path === "/api/capture/audio") {
        const token = bearerToken(req);
        if (!token || !(await captureAccess.accepts(token))) {
          voiceCaptureUnauthorized(res);
          return;
        }
        await handleVoiceCaptureIngest(app.cfg, app.voiceCaptures, req, res);
        return;
      }

      if (await handleSharePublicRoutes(app.cfg, app.shareLinks, shareLinkRateLimiter, req, res, path)) return;

      const getEarly = method === "GET" || method === "HEAD";
      if (getEarly && path === "/assets/whiteboard-editor.js") {
        return send(res, 200, await whiteboardEditorScript(), "text/javascript", { "cache-control": "public, max-age=86400" });
      }
      if (getEarly && path.startsWith("/assets/excalidraw/")) {
        const relative = path.slice("/assets/excalidraw/".length);
        const asset = await readExcalidrawAsset(relative);
        if (!asset) return json(res, 404, { error: "not found" });
        return send(res, 200, asset, excalidrawAssetContentType(relative), { "cache-control": "public, max-age=86400" });
      }

      const who = await app.auth(req, url);
      if (!who.ok) return send(res, who.status, `<h1>${who.status}</h1><p>${who.reason}</p>`);
      const extra: Record<string, string> = who.setCookie ? { "set-cookie": who.setCookie } : {};
      if (!csrfOk(req)) return json(res, 403, { error: "cross-site request refused" });
      const get = method === "GET" || method === "HEAD";

      if (get && path === "/assets/notes-editor.js") return send(res, 200, await notesEditorScript(), "text/javascript", extra);
      if (await handleQuickAddRoutes(
        app.cfg,
        app.calendar,
        canManageSharedServerState(app.cfg, { owner: who.owner === true, who: who.who }),
        who.owner === true,
        req,
        res,
        path,
        readBody,
      )) return;
      if (await handleVoiceCaptureOwnerRoutes(
        app.cfg,
        app.calendar,
        app.voiceCaptures,
        who.owner === true,
        req,
        res,
        path,
        readBody,
      )) return;
      if (app.calendar && await handleCalendarRoutes(app.calendar, req, res, path, who.owner === true, readBody)) return;
      if (path === "/api/connections" || path.startsWith("/api/connections/")) {
        if (!who.owner) return json(res, 403, { error: "Connection management requires a verified owner login. Set OWNER_EMAILS and sign in through Cloudflare Access; machine/admin tokens cannot manage keys." });
        if (!app.connections) return json(res, 503, { error: "Connection storage is unavailable" });
        if (path === "/api/connections" && get) return json(res, 200, app.connections.status());
        const match = path.match(/^\/api\/connections\/([^/]+)(\/test)?$/);
        if (!match) return json(res, 404, { error: "Connection route not found" });
        const provider = connectionProvider(match[1]!);
        if (match[2] && method === "POST") return json(res, 200, await app.connections.test(provider));
        if (!match[2] && method === "PUT") {
          await app.connections.update(provider, await readBody(req, 30_000));
          return json(res, 200, app.connections.status());
        }
        if (!match[2] && method === "DELETE") {
          await app.connections.remove(provider);
          return json(res, 200, app.connections.status());
        }
        return json(res, 405, { error: "Method not allowed" });
      }
      if (get && path === "/manifest.webmanifest") return send(res, 200, MANIFEST, "application/manifest+json", extra);
      if (get && path === "/sw.js") return send(res, 200, SERVICE_WORKER, "text/javascript", { ...extra, "service-worker-allowed": "/" });
      if (get && path === "/icon-192.png") return send(res, 200, icon("192", 192), "image/png", extra);
      if (get && path === "/icon-512.png") return send(res, 200, icon("512", 512), "image/png", extra);
      if (get && path === "/icon-maskable-512.png") return send(res, 200, icon("m512", 512, true), "image/png", extra);

      const nav = () => visibleNavTabs(app.settings.get().sidebarTabs, { whiteboard: app.cfg.whiteboardEnabled });

      if (get && path === "/") return send(res, 200, dashboardPage(nav()), undefined, extra);
      if (get && path === "/briefing") return send(res, 200, dailyBriefingPage(nav()), undefined, extra);
      if (get && (path === "/news" || path === "/summaries" || path === "/read-later")) {
        const query = new URLSearchParams(url.search);
        if (!query.has("view")) query.set("view", path === "/summaries" ? "summarized" : "inbox");
        res.writeHead(302, { location: `/library?${query}`, ...SECURITY, ...extra });
        res.end();
        return;
      }
      if (get && path === "/library") return send(res, 200, sourcesPage(nav()), undefined, extra);
      if (get && /^\/read-later\/[^/]+$/.test(path)) {
        res.writeHead(302, { location: path.replace("/read-later/", "/library/") + url.search, ...SECURITY, ...extra });
        res.end();
        return;
      }
      if (get && /^\/library\/[^/]+$/.test(path)) return send(res, 200, sourceDetailPage(nav()), undefined, extra);
      if (get && path === "/spaces") return send(res, 200, spacesPage(nav()), undefined, extra);
      if (get && /^\/spaces\/[^/]+$/.test(path)) return send(res, 200, spaceDetailPage(nav()), undefined, extra);
      if (get && path === "/agent") {
        const view = url.searchParams.get("view") ?? "board";
        const render = { board: boardPage, queue: agentQueuePage, wins: winsPage, assistant: assistantPage, activity: activityPage };
        if (!Object.hasOwn(render, view)) return json(res, 400, { error: "unknown Agent view" });
        return send(res, 200, render[view as keyof typeof render](nav()), undefined, extra);
      }
      const legacyAgentViews: Record<string, string> = { "/board": "board", "/hobie": "queue", "/hobie/queue": "queue", "/wins": "wins", "/assistant": "assistant", "/activity": "activity" };
      if (get && Object.hasOwn(legacyAgentViews, path)) {
        const query = new URLSearchParams(url.search);
        query.set("view", legacyAgentViews[path]!);
        res.writeHead(302, { location: `/agent?${query}`, ...SECURITY, ...extra });
        res.end();
        return;
      }
      if (get && path === "/settings/capture") return send(res, 200, capturePage(nav()), undefined, extra);
      if (get && path === "/settings/connections") return send(res, 200, connectionsPage(nav()), undefined, extra);
      if (get && path === "/settings/calendars") return send(res, 200, calendarSettingsPage(nav()), undefined, extra);
      if (get && path === "/capture-extension.zip") {
        return send(res, 200, extensionZip, "application/zip", { ...extra, "content-disposition": 'attachment; filename="command-center-capture.zip"' });
      }
      if (get && (path === "/notes/connections" || path === "/notes/transfer")) {
        return send(res, 200, noteToolsPage(nav(), path === "/notes/connections"), undefined, extra);
      }
      if (get && path === "/notes") return send(res, 200, notesPage(nav()), undefined, extra);
      if (get && path === "/bookmarks") return send(res, 200, bookmarksPage(nav()), undefined, extra);
      if (get && path === "/calendar") return send(res, 200, calendarPage(nav()), undefined, extra);
      if (get && path === "/calendar/event") return send(res, 200, calendarEventPage(nav()), undefined, extra);
      if (get && path === "/settings") return send(res, 200, settingsPage(nav()), undefined, extra);
      if (get && path === "/whiteboard") {
        if (!app.cfg.whiteboardEnabled) return json(res, 404, { error: "not found" });
        return send(res, 200, whiteboardPage(nav()), undefined, extra);
      }

      if (get && path === "/api/bookmarks") return json(res, 200, app.bookmarks.list());
      if (get && path === "/api/bookmarks/export.json") {
        return send(res, 200, JSON.stringify(app.bookmarks.list(), null, 2), "application/json", {
          ...extra, "content-disposition": 'attachment; filename="command-center-bookmarks.json"',
        });
      }
      if (path.startsWith("/api/bookmarks/")) {
        if (!["POST", "PATCH", "DELETE", "PUT"].includes(method)) return json(res, 405, { error: "method not allowed" });
        const stashed = (req as IncomingMessage & { __bookmarkImportBody?: unknown }).__bookmarkImportBody;
        const body = stashed !== undefined ? stashed : await readBody(req, 5_000_000);
        if (path === "/api/bookmarks/groups") {
          if (method === "POST") return json(res, 201, { group: await app.bookmarks.createGroup(body) });
          if (method === "PATCH") { await app.bookmarks.updateGroup(body); return json(res, 200, { ok: true }); }
          if (method === "DELETE") { await app.bookmarks.deleteGroup(body); return json(res, 200, { ok: true }); }
        }
        if (path === "/api/bookmarks/items") {
          if (method === "POST" || method === "PUT") return json(res, method === "POST" ? 201 : 200, { bookmark: await app.bookmarks.saveBookmark(body, method === "PUT") });
          if (method === "DELETE") { await app.bookmarks.deleteBookmark(body); return json(res, 200, { ok: true }); }
          if (method === "PATCH") { await app.bookmarks.moveBookmark(body); return json(res, 200, { ok: true }); }
        }
        if (path === "/api/bookmarks/preferences" && method === "PUT") {
          await app.bookmarks.preferences(body);
          return json(res, 200, { ok: true });
        }
        if (path === "/api/bookmarks/import" && method === "POST") {
          const importBody = (req as IncomingMessage & { __bookmarkImportBody?: unknown }).__bookmarkImportBody ?? body;
          return json(res, 200, await app.bookmarks.import(importBody));
        }
        return json(res, 404, { error: "bookmark route not found" });
      }

      if (await handleShareOwnerRoutes(app.cfg, app.notes, app.shareLinks, req, res, path, who.owner === true)) return;
      if (handleAgentQueueOwnerApi(app.agentTaskQueue, app.agentApprovals, req, res, path, who.owner === true)) return;
      if (await handleAgentApprovalRoutes(app.cfg, app.agentApprovals, req, res, path, who.owner === true, readBody)) return;

      if (get && path === "/api/state") {
        return json(res, 200, {
          version: app.cfg.version,
          tz: app.cfg.tz,
          llmEnabled: llmConfigured(app.cfg),
          recallioEnabled: recallioConfigured(app.cfg),
          shareLinksEnabled: app.cfg.shareLinksEnabled,
          owner: who.owner === true,
        });
      }
      if (get && path === "/api/dashboard-layout") return json(res, 200, { layout: app.dashboardLayout.get() });
      if (get && path === "/api/dashboard-layout/export.json") {
        return send(res, 200, JSON.stringify(app.dashboardLayout.get(), null, 2), "application/json", {
          ...extra,
          "content-disposition": 'attachment; filename="dashboard-layout.json"',
        });
      }
      if (req.method === "PUT" && path === "/api/dashboard-layout") {
        if (!canManageSharedServerState(app.cfg, { owner: who.owner === true, who: who.who })) {
          return json(res, 403, { error: OWNER_ACTION_FORBIDDEN });
        }
        const layout = await app.dashboardLayout.update(await readBody(req));
        return json(res, 200, { layout });
      }
      if (req.method === "POST" && path === "/api/dashboard-layout/import") {
        if (!who.owner) return json(res, 403, { error: OWNER_ACTION_FORBIDDEN });
        const layout = await app.dashboardLayout.update(await readBody(req, 64_000));
        return json(res, 200, { layout });
      }
      if (req.method === "POST" && path === "/api/dashboard-layout/reset") {
        if (!canManageSharedServerState(app.cfg, { owner: who.owner === true, who: who.who })) {
          return json(res, 403, { error: OWNER_ACTION_FORBIDDEN });
        }
        const layout = await app.dashboardLayout.reset();
        return json(res, 200, { layout });
      }

      if (get && path === "/api/notify/status") {
        const resolved = resolveNtfyConfig(deployment, app.cfg);
        return json(res, 200, { ...ntfyStatus(resolved), canTest: who.owner === true });
      }
      if (req.method === "POST" && path === "/api/notify/test") {
        if (!who.owner) return json(res, 403, { error: OWNER_ACTION_FORBIDDEN });
        const resolved = resolveNtfyConfig(deployment, app.cfg);
        if (!resolved.enabled) return json(res, 503, { error: "Phone notifications are not configured (set NTFY_TOPIC)." });
        const ok = await notify(resolved, {
          title: "Test notification",
          body: "If you see this on your phone, ntfy is working.",
          priority: "default",
          tags: ["test"],
        });
        return json(res, ok ? 200 : 502, { ok });
      }

      if (get && path === "/api/settings") {
        const principal = { owner: who.owner === true, who: who.who, email: who.email, serviceToken: who.serviceToken };
        const ntfy = { ...ntfyStatus(resolveNtfyConfig(deployment, app.cfg)), canTest: who.owner === true };
        return json(res, 200, {
          settings: app.settings.get(),
          briefingProviders: { search: Boolean(app.cfg.braveSearchApiKey), summarizer: llmConfigured(app.cfg) },
          ntfy,
          meta: {
            canManage: canManageSharedServerState(app.cfg, principal),
            signedInAs: who.who,
            ownerReason: computeOwnerReason(app.cfg, principal),
            ownerEmailsConfigured: app.cfg.ownerEmails.length > 0,
            connectionsStorage: Boolean(app.cfg.connectionsMasterKey),
            features: {
              shareLinksEnabled: app.cfg.shareLinksEnabled,
              whiteboardEnabled: app.cfg.whiteboardEnabled,
            },
          },
        });
      }
      if (req.method === "PUT" && path === "/api/settings") {
        if (!canManageSharedServerState(app.cfg, { owner: who.owner === true, who: who.who })) {
          return json(res, 403, { error: OWNER_ACTION_FORBIDDEN });
        }
        const next = await app.settings.update(await readBody(req));
        return json(res, 200, { settings: next });
      }

      if (
        path === "/api/capture/access"
        && (req.method === "POST" || req.method === "DELETE")
        && !canManageSharedServerState(app.cfg, { owner: who.owner === true, who: who.who })
      ) {
        return json(res, 403, { error: OWNER_ACTION_FORBIDDEN });
      }
      if (path.startsWith("/api/capture") || path.startsWith("/api/read-later")) {
        if (await handleReadLaterRoutes(app.notes, readLater, captureAccess, req, res, path, readBody)) return;
      }
      if (path.startsWith("/api/x-bookmarks")) {
        if (await handleXBookmarkApiRoutes(app.xBookmarks, req, res, path, readBody)) return;
      }
      if (await handleDailyBriefingRoutes(app, app.dailyBriefing, req, res, path, {
        owner: who.owner === true,
        who: who.who,
        email: who.email,
        serviceToken: who.serviceToken,
      }, readBody)) return;
      if (path.startsWith("/api/board") || path.startsWith("/api/wins")) {
        const bodyForApi = get ? undefined : await readBody(req);
        if (await handleBoardRoutes(app.board, app.hobieQueue, app.wins, app.cfg, req, res, path, bodyForApi)) return;
        if (await handleWinsRoutes(app.wins, app.cfg, app.winsRollup, req, res, path, bodyForApi)) return;
      }
      if (app.cfg.whiteboardEnabled && path.startsWith("/api/whiteboard/")) {
        if (await handleWhiteboardRoutes(app.whiteboard, who.owner === true, req, res, path)) return;
      }

      for (const panel of panels) {
        if (panel.handle && (await panel.handle(ctx(who.owner === true), req, res, path))) return;
      }

      return json(res, 404, { error: "not found" });
    } catch (err) {
      if (err instanceof CalendarConflictError) return json(res, 409, { error: err.message });
      if (err instanceof NoteConflictError) return json(res, 409, { error: err.message });
      if (err instanceof ValidationError) return json(res, 400, { error: err.message });
      console.error("request failed:", err);
      return json(res, 500, { error: "internal error" });
    }
  });
}
