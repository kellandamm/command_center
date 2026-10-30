/**
 * Dashboard header + grid screenshots for agents-usage panel PR.
 * PHASE=before|after OUT_DIR=docs/screenshots/dashboard-header
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { chromium, type BrowserContext, type Page } from "playwright";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "../test/helpers";
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "../test/cf-access-jwt";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const serverDir = join(repoRoot, "apps/server");
const ADMIN_TOKEN = "a".repeat(32);
const phase = process.env.PHASE === "after" ? "after" : "before";
const outDir = join(repoRoot, process.env.OUT_DIR ?? "docs/screenshots/dashboard-header", phase);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(baseUrl: string) {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${baseUrl}/healthz`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error("server not ready");
}

async function runSeed(script: string, dataDir: string, extraEnv: Record<string, string> = {}) {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("pnpm", ["exec", "tsx", script], {
      cwd: serverDir,
      env: { ...process.env, DATA_DIR: dataDir, ...extraEnv },
      stdio: "inherit",
    });
    seed.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed ${code}`))));
  });
}

async function startOwnerServer(dataDir: string, port: number) {
  const cfKeys = await createTestCfAccessJwt();
  const cfg = loadConfig({
    DATA_DIR: dataDir,
    ADMIN_TOKEN,
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: TEST_CF_AUD,
    OWNER_EMAILS: "owner@example.com",
    TZ: "UTC",
  });
  const settings = new SettingsStore(dataDir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dataDir, cfg.tz);
  const notes = await NotesStore.open(dataDir);
  const integration = await openIntegrationStores(dataDir, cfg);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async (token) => cfKeys.verifier(token)),
    settings,
    dailyBriefing,
    notes,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const base = `http://127.0.0.1:${port}`;
  const ownerJwt = await cfKeys.signEmailJwt("owner@example.com");
  const close = async () => {
    await closeIntegrationServer(server, integration);
  };
  return { base, ownerJwt, close };
}

async function themedContext(browser: Awaited<ReturnType<typeof chromium.launch>>, ownerJwt: string, theme: "light" | "dark", viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((mode) => {
    localStorage.setItem("cc-theme", mode);
  }, theme);
  await context.addCookies([{ name: "CF_Authorization", value: ownerJwt, domain: "127.0.0.1", path: "/" }]);
  return context;
}

async function shotPage(context: BrowserContext, base: string, path = "/") {
  const page = await context.newPage();
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  await page.waitForSelector("#dashboard-grid", { timeout: 30_000 });
  return page;
}

async function main() {
  const dataDir = process.env.DATA_DIR ?? `/tmp/cc-dash-header-${phase}`;
  const port = 4200 + Math.floor(Math.random() * 400);
  await mkdir(outDir, { recursive: true });

  await runSeed("scripts/seed-dashboard-screenshot.ts", dataDir);
  if (phase === "after") {
    await runSeed("scripts/seed-agents-usage-screenshot.ts", dataDir);
  }

  const app = await startOwnerServer(dataDir, port);
  const browser = await chromium.launch();
  try {
    await waitForServer(app.base);
    const shots: Array<{ name: string; width: number; height: number; theme: "light" | "dark"; path?: string }> = [
      { name: "dashboard-1440-light.png", width: 1440, height: 900, theme: "light" },
      { name: "dashboard-1440-dark.png", width: 1440, height: 900, theme: "dark" },
      { name: "dashboard-390-mobile-light.png", width: 390, height: 844, theme: "light" },
    ];
    if (phase === "after") {
      shots.push({ name: "agents-usage-panel-sample.png", width: 1440, height: 900, theme: "light", path: "/" });
    }

    for (const shot of shots) {
      const context = await themedContext(browser, app.ownerJwt, shot.theme, { width: shot.width, height: shot.height });
      const page = await shotPage(context, app.base, shot.path ?? "/");
      if (phase === "after" && shot.name.includes("sample")) {
        await page.waitForSelector("#panel-agents-usage .agents-usage-panel-pct", { timeout: 20_000 });
      }
      await page.screenshot({ path: join(outDir, shot.name), fullPage: false });
      await context.close();
    }

    if (phase === "after") {
      const staleDir = `${dataDir}-stale`;
      await runSeed("scripts/seed-dashboard-screenshot.ts", staleDir);
      await runSeed("scripts/seed-agents-usage-screenshot.ts", staleDir, { STALE: "1" });
      const stalePort = port + 1;
      const staleApp = await startOwnerServer(staleDir, stalePort);
      try {
        await waitForServer(staleApp.base);
        const context = await themedContext(browser, staleApp.ownerJwt, "light", { width: 1440, height: 900 });
        const page = await shotPage(context, staleApp.base);
        await page.waitForSelector("#panel-agents-usage .agents-usage-stale-banner:not([hidden])", { timeout: 20_000 });
        await page.screenshot({ path: join(outDir, "agents-usage-panel-stale.png"), fullPage: false });
        await context.close();
      } finally {
        await staleApp.close();
      }
    }

    const light = createHash("md5").update(await readFile(join(outDir, "dashboard-1440-light.png"))).digest("hex");
    const dark = createHash("md5").update(await readFile(join(outDir, "dashboard-1440-dark.png"))).digest("hex");
    if (light === dark) throw new Error("dark screenshot matches light bytes");
    console.log("wrote", outDir, "light", light.slice(0, 8), "dark", dark.slice(0, 8));
  } finally {
    await browser.close();
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
