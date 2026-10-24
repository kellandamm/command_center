/**
 * Settings-related screenshots for settings-accuracy PR (1280×800 and 390×844).
 * Usage: OUT_PREFIX=before pnpm exec tsx scripts/capture-settings-accuracy-screenshots.ts
 */
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { chromium, type Page } from "playwright";

const serverDir = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = join(serverDir, "../..");
const prefix = process.env.OUT_PREFIX ?? "after";
const baseDir = join(repoRoot, "docs/screenshots/settings-accuracy");

type Shot = {
  name: string;
  path: string;
  viewport: { width: number; height: number };
  prepare?: (page: Page) => Promise<void>;
};

const SHOTS: Shot[] = [
  { name: "settings-views", path: "/settings", viewport: { width: 1280, height: 800 } },
  {
    name: "settings-schedule",
    path: "/settings",
    viewport: { width: 1280, height: 800 },
    prepare: async (page) => {
      await page.click('.settings-tabs button[data-tab="schedule"]');
      await page.waitForSelector("#tab-schedule.on #briefingTime", { timeout: 15_000 });
    },
  },
  {
    name: "settings-tabs",
    path: "/settings",
    viewport: { width: 1280, height: 800 },
    prepare: async (page) => {
      await page.click('.settings-tabs button[data-tab="tabs"]');
      await page.waitForSelector("#tab-tabs.on #tabs-editor", { timeout: 15_000 });
    },
  },
  {
    name: "settings-topics",
    path: "/settings#topics",
    viewport: { width: 1280, height: 800 },
    prepare: async (page) => {
      await page.waitForSelector("#tab-topics.on #briefingTopics", { timeout: 15_000 });
    },
  },
  { name: "settings-connections", path: "/settings/connections", viewport: { width: 1280, height: 800 } },
  { name: "settings-calendars", path: "/settings/calendars", viewport: { width: 1280, height: 800 } },
  {
    name: "settings-views-mobile",
    path: "/settings",
    viewport: { width: 390, height: 844 },
    prepare: async (page) => {
      await page.waitForSelector("#tab-views.on", { timeout: 15_000 });
    },
  },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(baseUrl: string) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${baseUrl}/healthz`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error(`Server not ready at ${baseUrl}`);
}

function startApp(dataDir: string, port: number): ChildProcess {
  return spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      HOST: "127.0.0.1",
      PORT: String(port),
      ALLOW_INSECURE_NO_AUTH: "1",
      TZ: "UTC",
      BRAVE_SEARCH_API_KEY: "screenshot-search",
      LLM_BASE_URL: "https://api.example/v1",
      LLM_API_KEY: "sk-shot",
      LLM_MODEL: "test",
      CONNECTIONS_MASTER_KEY: "a".repeat(64),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function main() {
  await new Promise<void>((resolve, reject) => {
    const build = spawn("pnpm", ["run", "build"], { cwd: serverDir, stdio: "inherit" });
    build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`build ${code}`))));
  });

  const dataDir = await mkdtemp(join(tmpdir(), "cc-settings-shot-"));
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("pnpm", ["exec", "tsx", "scripts/seed-ui-screenshots.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
    seed.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed ${code}`))));
  });

  const port = 3947 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${port}`;
  const app = startApp(dataDir, port);
  const digests: Array<{ path: string; md5: string }> = [];
  try {
    await waitForServer(baseUrl);
    const browser = await chromium.launch();
    const page = await browser.newPage();
    for (const shot of SHOTS) {
      await page.setViewportSize(shot.viewport);
      await page.goto(`${baseUrl}${shot.path}`, { waitUntil: "domcontentloaded" });
      if (shot.prepare) await shot.prepare(page);
      const tag = `${shot.viewport.width}x${shot.viewport.height}`;
      const rel = `${prefix}-${shot.name}-${tag}.png`;
      const outPath = join(baseDir, rel);
      await page.screenshot({ path: outPath, fullPage: false });
      const buf = await readFile(outPath);
      const md5 = createHash("md5").update(buf).digest("hex");
      digests.push({ path: `docs/screenshots/settings-accuracy/${rel}`, md5 });
      console.log("wrote", rel, md5);
    }
    await browser.close();
    console.log(JSON.stringify(digests, null, 2));
  } finally {
    app.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
