import { join } from "node:path";
import { assertAuthConfigured, loadConfig } from "./config";
import { makeAuthenticator } from "./auth";
import { BuildManager } from "./build";
import { createApp } from "./http";
import { loadPricingOverride } from "./pricing";
import { Scheduler } from "./scheduler";
import { SettingsStore } from "./settings";
import { EditionStore, FileKV, Ledger, ensureDirs } from "./store";

async function main() {
  const cfg = loadConfig();
  assertAuthConfigured(cfg);
  if (cfg.allowInsecureNoAuth && !cfg.cfTeamDomain && !cfg.adminToken && cfg.host !== "127.0.0.1") {
    console.warn("WARNING: ALLOW_INSECURE_NO_AUTH is set and the server is not bound to 127.0.0.1.");
  }
  const dirs = await ensureDirs(cfg.dataDir);
  const kv = await FileKV.open(join(cfg.dataDir, "state.json"));
  const settings = new SettingsStore(cfg.dataDir);
  await settings.load();
  const ledger = new Ledger(join(cfg.dataDir, "ledger.jsonl"));
  const editions = new EditionStore(dirs.editions);
  const manager = new BuildManager({ cfg, settings, kv, ledger, editions, pricing: loadPricingOverride(process.env.PRICING_JSON) });

  await manager.recover();
  const scheduler = new Scheduler({ manager, settings, kv, editions, tz: cfg.tz });
  const server = createApp({ cfg, auth: makeAuthenticator(cfg), manager, settings, editions, ledger });
  server.listen(cfg.port, cfg.host, () => {
    console.log(`ai-homepage ${cfg.version} listening on ${cfg.host}:${cfg.port} (tz ${cfg.tz})`);
    console.log(cfg.anthropicApiKey ? "Anthropic key: set" : "Anthropic key: NOT SET (builds disabled)");
  });
  scheduler.start();

  let stopping = false;
  const shutdown = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${sig}: shutting down`);
    scheduler.stop();
    server.close();
    // Cancelling lets the build delete its session and uploaded pages before we exit.
    await manager.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
