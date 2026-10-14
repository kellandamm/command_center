import { join } from "node:path";
import { assertAuthConfigured, llmConfigured, loadConfig } from "./config";
import { makeAuthenticator } from "./auth";
import { BriefingService } from "./briefing/service";
import { AiSecurityService } from "./ai-security/service";
import { DailyBriefingService } from "./daily-briefing/service";
import { NewsPrefsStore } from "./feeds/news-prefs";
import { FeedsStore } from "./feeds/store";
import { createApp } from "./http";
import { Scheduler } from "./scheduler";
import { SettingsStore } from "./settings";
import { NotesStore } from "./notes/store";
import { HobieQueueStore } from "./stores/hobie-queue";
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
  const feeds = await FeedsStore.open(cfg.dataDir, { settingsFeeds: settings.get().feeds });
  const newsPrefs = await NewsPrefsStore.open(cfg.dataDir);
  const briefing = await BriefingService.open(cfg.dataDir, cfg.tz);
  const aiSecurity = await AiSecurityService.open(cfg.dataDir);
  const dailyBriefing = await DailyBriefingService.open(cfg.dataDir, cfg.tz);
  const notes = await NotesStore.open(cfg.dataDir);
  const panelUpdates = await PanelUpdatesStore.open(cfg.dataDir);
  const hobieQueue = await HobieQueueStore.open(cfg.dataDir);
  const dashboardLayout = await DashboardLayoutStore.open(cfg.dataDir, panels.map((p) => p.id));

  const scheduler = new Scheduler({ cfg, settings, kv, feeds, briefing, dailyBriefing });
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg),
    settings,
    feeds,
    briefing,
    aiSecurity,
    dailyBriefing,
    newsPrefs,
    notes,
    panelUpdates,
    hobieQueue,
    dashboardLayout,
  });
  server.listen(cfg.port, cfg.host, () => {
    console.log(`command-center ${cfg.version} listening on ${cfg.host}:${cfg.port} (tz ${cfg.tz})`);
    console.log(llmConfigured(cfg) ? "LLM: configured" : "LLM: not set (briefing disabled)");
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
