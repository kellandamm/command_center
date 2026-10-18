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
import { WinsStore } from "./wins/store";
import { WinsRollupService } from "./wins/rollup-service";
import { PanelUpdatesStore } from "./stores/panel-updates";
import { DashboardLayoutStore } from "./dashboard-layout/storage";
import { panels } from "./panels/registry";
import { FileKV, ensureDirs } from "./store";

async function main() {
  const cfg = loadConfig();
  assertAuthConfigured(cfg);
  if (cfg.allowInsecureNoAuth && !cfg.cfTeamDomain && !cfg.adminToken && cfg.host !== "127.0.0.1") {
    console.warn("WARNING: ALLOW_INSECURE_NO_AUTH is set and the server is not bound to 127.0.0.1.");
  }
  await ensureDirs(cfg.dataDir);
  const kv = await FileKV.open(join(cfg.dataDir, "state.json"));
  const settings = new SettingsStore(cfg.dataDir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(cfg.dataDir, cfg.tz);
  const notes = await NotesStore.open(cfg.dataDir);
  const bookmarks = await BookmarksStore.open(cfg.dataDir);
  const panelUpdates = await PanelUpdatesStore.open(cfg.dataDir);
  const hobieQueue = await HobieQueueStore.open(cfg.dataDir);
  const board = BoardStore.open(cfg.dataDir);
  const wins = WinsStore.open(cfg.dataDir);
  wireHobieBoardSync(hobieQueue, board, wins);
  const winsRollup = new WinsRollupService(cfg, wins);
  const dashboardLayout = await DashboardLayoutStore.open(cfg.dataDir, panels.map((p) => p.id));

  const scheduler = new Scheduler({
    cfg,
    settings,
    kv,
    dailyBriefing,
    board,
    wins,
  });
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg),
    settings,
    dailyBriefing,
    notes,
    bookmarks,
    panelUpdates,
    hobieQueue,
    board,
    wins,
    winsRollup,
    dashboardLayout,
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
