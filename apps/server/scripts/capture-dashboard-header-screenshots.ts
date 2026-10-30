/**
 * Dashboard header + grid screenshots for agents-usage panel PR.
 * PHASE=before|after OUT_DIR=docs/screenshots/dashboard-header
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

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

function startServer(dataDir: string, port: number): ChildProcess {
  return spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      HOST: "127.0.0.1",
      PORT: String(port),
      ALLOW_INSECURE_NO_AUTH: "1",
      TZ: "UTC",
      ADMIN_TOKEN,
      OWNER_EMAILS: "owner@example.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function runSeed(script: string, dataDir: string, extraEnv: Record<string, string> = {}) {
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("pnpm", ["exec", "tsx", script], {
      cwd: serverDir,
      env: { ...process.env, DATA_DIR: dataDir, ...extraEnv },
      stdio: "inherit",
    });
    seed.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed ${code}`))));
  });
}

async function main() {
  const dataDir = process.env.DATA_DIR ?? `/tmp/cc-dash-header-${phase}`;
  const port = 4200 + Math.floor(Math.random() * 400);
  const base = `http://127.0.0.1:${port}`;
  await mkdir(outDir, { recursive: true });

  await runSeed("scripts/seed-dashboard-screenshot.ts", dataDir);
  if (phase === "after") {
    await runSeed("scripts/seed-agents-usage-screenshot.ts", dataDir);
  }

  const app = startServer(dataDir, port);
  const browser = await chromium.launch();
  try {
    await waitForServer(base);
    const shots: Array<{ name: string; width: number; height: number; dark?: boolean; path?: string }> = [
      { name: "dashboard-1440-light.png", width: 1440, height: 900 },
      { name: "dashboard-1440-dark.png", width: 1440, height: 900, dark: true },
      { name: "dashboard-390-mobile-light.png", width: 390, height: 844 },
    ];
    if (phase === "after") {
      shots.push({ name: "agents-usage-panel-sample.png", width: 1440, height: 900, path: "/" });
    }

    for (const shot of shots) {
      const context = await browser.newContext({
        viewport: { width: shot.width, height: shot.height },
      });
      await context.addCookies([
        {
          name: "ah_token",
          value: ADMIN_TOKEN,
          domain: "127.0.0.1",
          path: "/",
        },
      ]);
      const page = await context.newPage();
      if (shot.dark) {
        await page.addInitScript(() => {
          document.documentElement.classList.add("dark");
        });
      }
      const url = shot.path ? `${base}${shot.path}` : `${base}/`;
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForSelector("#dashboard-grid", { timeout: 30_000 });
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
      const staleApp = startServer(staleDir, port + 1);
      try {
        await waitForServer(`http://127.0.0.1:${port + 1}`);
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await context.addCookies([{ name: "ah_token", value: ADMIN_TOKEN, domain: "127.0.0.1", path: "/" }]);
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${port + 1}/`, { waitUntil: "networkidle" });
        await page.waitForSelector("#panel-agents-usage .agents-usage-stale-banner:not([hidden])", { timeout: 20_000 });
        await page.evaluate(() => {
          const item = document.querySelector('.dashboard-item[data-panel-id="agents-usage"]');
          item?.classList.remove("is-collapsed");
        });
        await page.waitForSelector("#panel-agents-usage .agents-usage-stale-banner:not([hidden])", { timeout: 5000 });
        await page.screenshot({ path: join(outDir, "agents-usage-panel-stale.png"), fullPage: false });
        await context.close();
      } finally {
        staleApp.kill("SIGTERM");
      }
    }
    console.log("wrote", outDir);
  } finally {
    await browser.close();
    app.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
