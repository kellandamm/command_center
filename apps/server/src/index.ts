import { join } from "node:path";
import { assertAuthConfigured, loadConfig } from "./config";
import { makeAuthenticator } from "./auth";
import { DailyBriefingService } from "./daily-briefing/service";
import { createApp } from "./http";
import { Scheduler } from "./scheduler";
import { SettingsStore } from "./settings";
import { NotesStore } from "./notes/store";
import { BookmarksStore } from "./bookmarks/store";
import { BoardStore } from "./board/store";
import { wireHobieBoardSync } from "./board/hobie-sync";
import { HobieQueueStore } from "./stores/hobie-queue";
import { AgentTaskQueueStore } from "./stores/agent-task-queue";
import { AgentApprovalsStore } from "./stores/agent-approvals";
import { WinsStore } from "./wins/store";
import { WinsRollupService } from "./wins/rollup-service";
import { PanelUpdatesStore } from "./stores/panel-updates";
import { DashboardLayoutStore } from "./dashboard-layout/storage";
import { migrateSavedArticles } from "./read-later/service";
import { XBookmarksStore } from "./read-later/x-bookmarks-store";
import { XBookmarksService } from "./read-later/x-bookmarks-service";
import { panels } from "./panels/registry";
import { FileKV, ensureDirs } from "./store";
import { ConnectionsStore } from "./connections";
import { CalendarWorkspace } from "./calendar/workspace";
import { AttentionStore } from "./attention/store";
import { LaunchpadStore } from "./launchpad/store";
import { WhiteboardStore } from "./whiteboard/store";

async function main() {
  const deployment = loadConfig();
  assertAuthConfigured(deployment);
  await ensureDirs(deployment.dataDir);
  const connections = await ConnectionsStore.open(deployment);
  const cfg = connections.config;
  if (cfg.allowInsecureNoAuth && !cfg.cfTeamDomain && !cfg.adminToken && cfg.host !== "127.0.0.1") {
    console.warn("WARNING: ALLOW_INSECURE_NO_AUTH is set and the server is not bound to 127.0.0.1.");
  }
  const kv = await FileKV.open(join(cfg.dataDir, "state.json"));
  const settings = new SettingsStore(cfg.dataDir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(cfg.dataDir, cfg.tz);
  const notes = await NotesStore.open(cfg.dataDir);
  const migrated = await migrateSavedArticles(cfg.dataDir, notes);
  if (migrated) console.log(`Moved ${migrated} saved articles into Read later`);
  const bookmarks = await BookmarksStore.open(cfg.dataDir);
  const xBookmarks = await XBookmarksStore.open(cfg.dataDir);
  const xBookmarksService = new XBookmarksService(cfg, xBookmarks);
  const panelUpdates = await PanelUpdatesStore.open(cfg.dataDir);
  const hobieQueue = await HobieQueueStore.open(cfg.dataDir);
  const agentTaskQueue = await AgentTaskQueueStore.open(cfg.dataDir);
  const agentApprovals = await AgentApprovalsStore.open(cfg.dataDir);
  const board = BoardStore.open(cfg.dataDir);
  const calendar = await CalendarWorkspace.open(cfg, connections, { notes, board });
  const wins = WinsStore.open(cfg.dataDir);
  wireHobieBoardSync(hobieQueue, board, wins);
  const winsRollup = new WinsRollupService(cfg, wins);
  const dashboardLayout = await DashboardLayoutStore.open(cfg.dataDir, panels.map((p) => p.id));
  const attention = await AttentionStore.open(cfg.dataDir);
  const launchpad = await LaunchpadStore.open(cfg.dataDir);
  const whiteboard = await WhiteboardStore.open(cfg.dataDir);

  const scheduler = new Scheduler({
    cfg,
    settings,
    kv,
    dailyBriefing,
    board,
    wins,
    calendar,
  });
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg),
    settings,
    dailyBriefing,
    notes,
    bookmarks,
    xBookmarks,
    xBookmarksService,
    panelUpdates,
    hobieQueue,
    agentTaskQueue,
    agentApprovals,
    board,
    wins,
    winsRollup,
    dashboardLayout,
    attention,
    launchpad,
    whiteboard,
    connections,
    calendar,
  });
  server.listen(cfg.port, cfg.host, () => {
    console.log(`command-center ${cfg.version} listening on ${cfg.host}:${cfg.port} (tz ${cfg.tz})`);
  });
  scheduler.start();

  const shutdown = (sig: string) => {
    console.log(`${sig}: shutting down`);
    scheduler.stop();
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
