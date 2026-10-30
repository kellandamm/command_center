/**
 * Restyle before/after screenshots (1440 + mobile, light + dark).
 * Usage: pnpm exec tsx scripts/capture-restyle-screenshots.ts [--before|--after]
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { chromium, type Page } from "playwright";
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "../test/cf-access-jwt";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { SettingsStore } from "../src/settings";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { NotesStore } from "../src/notes/store";
import { closeIntegrationServer, openIntegrationStores } from "../test/helpers";

const serverDir = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = join(serverDir, "../..");
const mode = process.argv.includes("--before") ? "before" : "after";
const outRoot = join(repoRoot, "docs/screenshots/restyle", mode);

type Shot = { name: string; path: string; marker: string; viewport: { width: number; height: number }; theme?: "light" | "dark"; prepare?: (page: Page) => Promise<void> };

const SHOTS: Shot[] = [
  { name: "dashboard-1440-light", path: "/", marker: "Dashboard", viewport: { width: 1440, height: 900 }, prepare: async (p) => { await p.waitForSelector("#dashboard-grid", { timeout: 20_000 }); } },
  { name: "dashboard-1440-dark", path: "/", marker: "Dashboard", viewport: { width: 1440, height: 900 }, theme: "dark", prepare: async (p) => { await p.evaluate(() => { document.documentElement.classList.add("dark"); localStorage.setItem("cc-theme", "dark"); }); await p.waitForSelector("#dashboard-grid", { timeout: 20_000 }); } },
  { name: "dashboard-mobile-light", path: "/", marker: "Dashboard", viewport: { width: 390, height: 844 }, prepare: async (p) => { await p.waitForSelector("#dashboard-grid", { timeout: 20_000 }); } },
  { name: "dashboard-mobile-dark", path: "/", marker: "Dashboard", viewport: { width: 390, height: 844 }, theme: "dark", prepare: async (p) => { await p.evaluate(() => { document.documentElement.classList.add("dark"); localStorage.setItem("cc-theme", "dark"); }); await p.waitForSelector("#dashboard-grid", { timeout: 20_000 }); } },
  { name: "agents-usage-1440-light", path: "/agent?view=usage", marker: "Agent usage", viewport: { width: 1440, height: 900 }, prepare: waitUsageReady },
  { name: "agents-usage-1440-dark", path: "/agent?view=usage", marker: "Agent usage", viewport: { width: 1440, height: 900 }, theme: "dark", prepare: waitUsageReadyDark },
  { name: "agents-usage-mobile-light", path: "/agent?view=usage", marker: "Agent usage", viewport: { width: 390, height: 844 }, prepare: waitUsageReady },
  { name: "agents-usage-mobile-dark", path: "/agent?view=usage", marker: "Agent usage", viewport: { width: 390, height: 844 }, theme: "dark", prepare: waitUsageReadyDark },
  { name: "notes-1440-light", path: "/notes", marker: "Notes", viewport: { width: 1440, height: 900 }, prepare: async (p) => { await p.waitForSelector("#knowledge-note-list", { timeout: 20_000 }); } },
  { name: "notes-1440-dark", path: "/notes", marker: "Notes", viewport: { width: 1440, height: 900 }, theme: "dark", prepare: async (p) => { await p.evaluate(() => { document.documentElement.classList.add("dark"); localStorage.setItem("cc-theme", "dark"); }); await p.waitForSelector("#knowledge-note-list", { timeout: 20_000 }); } },
  { name: "notes-mobile-light", path: "/notes", marker: "Notes", viewport: { width: 390, height: 844 }, prepare: async (p) => { await p.waitForSelector("#knowledge-note-list", { timeout: 20_000 }); } },
];

async function waitUsageReady(p: Page) {
  await p.waitForFunction(() => { const r = document.getElementById("usage-root"); return r && !r.hidden; }, undefined, { timeout: 25_000 });
  await p.waitForFunction(() => {
    const cap = document.querySelector("#usage-line-chart line.line-cap");
    if (!cap) return false;
    return cap.getAttribute("stroke-dasharray") === "none";
  }, undefined, { timeout: 10_000 });
}
async function waitUsageReadyDark(p: Page) {
  await p.evaluate(() => { document.documentElement.classList.add("dark"); localStorage.setItem("cc-theme", "dark"); });
  await waitUsageReady(p);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(baseUrl: string) {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) return;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error("server not ready");
}

async function startOwnerServer(dataDir: string) {
  const cf = await createTestCfAccessJwt();
  const cfg = loadConfig({
    DATA_DIR: dataDir,
    HOST: "127.0.0.1",
    PORT: "3847",
    ALLOW_INSECURE_NO_AUTH: "1",
    TZ: "UTC",
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: TEST_CF_AUD,
    OWNER_EMAILS: "owner@example.com",
  });
  const settings = new SettingsStore(dataDir);
  await settings.load();
  const integration = await openIntegrationStores(dataDir, cfg);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async (token) => cf.verifier(token)),
    settings,
    dailyBriefing: await DailyBriefingService.open(dataDir, cfg.tz),
    notes: await NotesStore.open(dataDir),
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ownerJwt = await cf.signEmailJwt("owner@example.com");
  return {
    base,
    ownerJwt,
    close: async () => {
      await closeIntegrationServer(server, integration);
    },
  };
}

async function ownerContext(browser: Awaited<ReturnType<typeof chromium.launch>>, baseUrl: string, ownerJwt: string) {
  const context = await browser.newContext();
  const host = new URL(baseUrl).hostname;
  await context.addCookies([{ name: "CF_Authorization", value: ownerJwt, domain: host, path: "/" }]);
  return context;
}

async function main() {
  await mkdir(outRoot, { recursive: true });
  let gitSha = "unknown";
  try {
    gitSha = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    /* best effort */
  }
  console.log("capture", mode, "git", gitSha);
  await writeFile(join(outRoot, "git-sha.txt"), `${gitSha}\n`, "utf8");
  const dataDir = await mkdtemp(join(tmpdir(), "cc-restyle-"));
  await new Promise<void>((resolve, reject) => {
    const seed2 = spawn("pnpm", ["exec", "tsx", "scripts/seed-dashboard-screenshot.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
    seed2.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`seed2 ${c}`))));
  });
  await new Promise<void>((resolve, reject) => {
    const seedUsage = spawn("pnpm", ["exec", "tsx", "scripts/seed-agents-usage-screenshot.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
    seedUsage.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`seedUsage ${c}`))));
  });
  await new Promise<void>((resolve, reject) => {
    const seed3 = spawn("pnpm", ["exec", "tsx", "scripts/seed-ui-screenshots.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
    seed3.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`seed3 ${c}`))));
  });
  const { base: baseUrl, ownerJwt, close: closeServer } = await startOwnerServer(dataDir);
  try {
    const browser = await chromium.launch();
    const context = await ownerContext(browser, baseUrl, ownerJwt);
    for (const shot of SHOTS) {
      const page = await context.newPage();
      await page.setViewportSize(shot.viewport);
      if (shot.theme === "dark") {
        await page.addInitScript(() => {
          localStorage.setItem("cc-theme", "dark");
          document.documentElement.classList.add("dark");
        });
      } else {
        await page.addInitScript(() => localStorage.setItem("cc-theme", "light"));
      }
      await page.goto(`${baseUrl}${shot.path}`, { waitUntil: "domcontentloaded" });
      if (shot.prepare) await shot.prepare(page);
      const title = await page.title();
      const h1 = (await page.locator("h1").first().textContent()) ?? "";
      if (!`${h1} ${title}`.toLowerCase().includes(shot.marker.toLowerCase())) {
        throw new Error(`marker ${shot.marker} missing on ${shot.path}`);
      }
      if (shot.theme === "dark") {
        const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
        if (!dark) throw new Error(`not dark: ${shot.name}`);
      }
      const outPath = join(outRoot, `${shot.name}.png`);
      await page.screenshot({ path: outPath, fullPage: false });
      console.log("wrote", outPath);
      await page.close();
    }
    await context.close();
    await browser.close();
    await writeFile(join(outRoot, "README.md"), `# Restyle ${mode} screenshots\n\nCaptured at ${new Date().toISOString()} UTC.\nGit: \`${gitSha}\`\n`);
  } finally {
    await closeServer();
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
