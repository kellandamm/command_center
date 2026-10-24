/**
 * Before/after theme screenshots (light + dark) for the gray / royal / orange palette.
 *
 * Usage (from apps/server):
 *   PHASE=before pnpm capture:theme-screenshots
 *   PHASE=after pnpm capture:theme-screenshots
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium, type Page } from "playwright";

const serverDir = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = join(serverDir, "../..");
const phase = process.env.PHASE === "before" ? "before" : "after";
const outRoot = join(repoRoot, "docs/screenshots/theme-gray-royal-orange", phase);

type Shot = {
  file: string;
  path: string;
  marker: string;
  viewport?: { width: number; height: number };
  prepare?: (page: Page) => Promise<void>;
};

const SHOTS: Shot[] = [
  {
    file: "dashboard-1280x800.png",
    path: "/",
    marker: "Dashboard",
    prepare: async (page) => {
      await page.waitForSelector("#dashboard-grid", { timeout: 20_000 });
      await page.waitForSelector("#panel-tasks", { timeout: 20_000 });
    },
  },
  {
    file: "dashboard-mobile-390x844.png",
    path: "/",
    marker: "Dashboard",
    viewport: { width: 390, height: 844 },
    prepare: async (page) => {
      await page.waitForSelector("#dashboard-grid .dashboard-item", { timeout: 20_000 });
    },
  },
  {
    file: "notes-1280x800.png",
    path: "/notes",
    marker: "Notes",
    prepare: async (page) => {
      await page.waitForSelector("#knowledge-note-list", { timeout: 20_000 });
    },
  },
  {
    file: "board-1280x800.png",
    path: "/agent?view=board",
    marker: "Board",
    prepare: async (page) => {
      await page.waitForSelector(".board-col-list .board-card", { timeout: 20_000 });
    },
  },
  {
    file: "calendar-1280x800.png",
    path: "/calendar",
    marker: "Calendar",
    prepare: async (page) => {
      await page.waitForSelector("#cal-week-grid", { timeout: 15_000 });
    },
  },
  {
    file: "settings-1280x800.png",
    path: "/settings",
    marker: "Settings",
    prepare: async (page) => {
      await page.waitForSelector(".settings-tabs", { timeout: 15_000 });
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
  throw new Error("server not ready");
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
      ICS_LOCAL_FILES: join(serverDir, "test/fixtures/demo-week.ics"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const META = phase === "before"
  ? { light: "#ffffff", dark: "#0a0a0a" }
  : { light: "#fafafa", dark: "#09090b" };

async function applyTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate(
    ({ mode, metaColor }) => {
      localStorage.setItem("cc-theme", mode);
      document.documentElement.classList.toggle("dark", mode === "dark");
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", metaColor);
    },
    { mode: theme, metaColor: META[theme] },
  );
}

async function capture(page: Page, baseUrl: string, shot: Shot, theme: "light" | "dark") {
  const vp = shot.viewport ?? { width: 1280, height: 800 };
  await page.setViewportSize(vp);
  await page.goto(`${baseUrl}${shot.path}`, { waitUntil: "domcontentloaded" });
  await applyTheme(page, theme);
  if (shot.prepare) await shot.prepare(page);
  const themeSuffix = theme === "dark" ? "-dark" : "-light";
  const baseName = shot.file.replace(/\.png$/, "");
  const out = join(outRoot, `${baseName}${themeSuffix}.png`);
  await mkdir(outRoot, { recursive: true });
  await page.screenshot({ path: out, fullPage: false });
  console.log("wrote", out.replace(repoRoot + "/", ""));
}

async function main() {
  await new Promise<void>((resolve, reject) => {
    const build = spawn("pnpm", ["run", "build"], { cwd: serverDir, stdio: "inherit" });
    build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`build ${code}`))));
  });

  const dataDir = await mkdtemp(join(tmpdir(), "cc-theme-shot-"));
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("pnpm", ["exec", "tsx", "scripts/seed-ui-screenshots.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
    seed.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed ${code}`))));
  });

  const port = 4100 + Math.floor(Math.random() * 400);
  const baseUrl = `http://127.0.0.1:${port}`;
  const app = startApp(dataDir, port);
  try {
    await waitForServer(baseUrl);
    const browser = await chromium.launch();
    const page = await browser.newPage();
    for (const theme of ["light", "dark"] as const) {
      for (const shot of SHOTS) {
        await capture(page, baseUrl, shot, theme);
      }
    }
    await browser.close();

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(outRoot);
    for (const f of files.sort()) {
      if (!f.endsWith(".png")) continue;
      const buf = await readFile(join(outRoot, f));
      const md5 = createHash("md5").update(buf).digest("hex");
      console.log("md5", md5, f);
    }
  } finally {
    app.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
