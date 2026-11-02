import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const OUT = join(import.meta.dirname, "../../../docs/dashboard-revamp/screenshots");

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(base: string) {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error("server not ready");
}

function startServer(dataDir: string, port: number): ChildProcess {
  return spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: join(import.meta.dirname, ".."),
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      HOST: "127.0.0.1",
      PORT: String(port),
      ALLOW_INSECURE_NO_AUTH: "1",
    },
    stdio: "ignore",
  });
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-revamp-shot-"));
  const port = 4400 + Math.floor(Math.random() * 200);
  const base = `http://127.0.0.1:${port}`;
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("pnpm", ["exec", "tsx", "scripts/seed-dashboard-screenshot.ts"], {
      cwd: join(import.meta.dirname, ".."),
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
    seed.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(String(code)))));
  });
  const app = startServer(dataDir, port);
  const browser = await chromium.launch();
  try {
    await waitForServer(base);
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${base}/`);
    await page.waitForSelector("#dashboard-grid", { timeout: 30_000 });
    await sleep(800);
    await page.screenshot({ path: join(OUT, "dashboard-normal-1280.png"), fullPage: true });
    await page.locator("#dashboard-edit-toggle").click();
    await page.waitForSelector(".dashboard-page.is-editing");
    await sleep(400);
    await page.screenshot({ path: join(OUT, "dashboard-edit-1280.png"), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await sleep(400);
    await page.screenshot({ path: join(OUT, "dashboard-mobile-375.png"), fullPage: true });
  } finally {
    await browser.close();
    app.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
