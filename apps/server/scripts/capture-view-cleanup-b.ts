/**
 * Notes, library, spaces, and dashboard shots for UI audit PR B.
 * Usage: pnpm exec tsx scripts/capture-view-cleanup-b.ts --prefix before|after
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
const prefix = process.argv.includes("--prefix")
  ? process.argv[process.argv.indexOf("--prefix") + 1] ?? "after"
  : "after";

type Shot = { name: string; path: string; width: number; height: number; dark?: boolean; prepare?: (page: Page) => Promise<void> };

const SHOTS: Shot[] = [
  { name: "notes-1280x800-light.png", path: "/notes", width: 1280, height: 800, prepare: prepareNotes },
  { name: "notes-1280x800-dark.png", path: "/notes", width: 1280, height: 800, dark: true, prepare: prepareNotes },
  { name: "notes-390x844-light.png", path: "/notes", width: 390, height: 844, prepare: prepareNotes },
  { name: "notes-390x844-dark.png", path: "/notes", width: 390, height: 844, dark: true, prepare: prepareNotes },
  { name: "library-1280x800-light.png", path: "/library", width: 1280, height: 800, prepare: prepareLibrary },
  { name: "library-1280x800-dark.png", path: "/library", width: 1280, height: 800, dark: true, prepare: prepareLibrary },
  { name: "spaces-1280x800-light.png", path: "/spaces", width: 1280, height: 800, prepare: prepareSpaces },
  { name: "spaces-1280x800-dark.png", path: "/spaces", width: 1280, height: 800, dark: true, prepare: prepareSpaces },
  { name: "dashboard-1280x800-light.png", path: "/", width: 1280, height: 800, prepare: prepareDashboard },
  { name: "dashboard-1280x800-dark.png", path: "/", width: 1280, height: 800, dark: true, prepare: prepareDashboard },
  { name: "dashboard-390x844-light.png", path: "/", width: 390, height: 844, prepare: prepareDashboard },
  { name: "dashboard-390x844-dark.png", path: "/", width: 390, height: 844, dark: true, prepare: prepareDashboard },
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

function startAppServer(dataDir: string, port: number): ChildProcess {
  return spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      HOST: "127.0.0.1",
      PORT: String(port),
      ALLOW_INSECURE_NO_AUTH: "1",
      TZ: "UTC",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function prepareDashboard(page: Page) {
  await page.waitForSelector("#dashboard-grid", { timeout: 20_000 });
  await page.waitForSelector("#panel-tasks", { timeout: 20_000 });
}

async function prepareNotes(page: Page) {
  await page.waitForSelector("#knowledge-note-list", { timeout: 20_000 });
}

async function prepareLibrary(page: Page) {
  await page.waitForSelector("#source-list", { timeout: 20_000 });
  await page.waitForFunction(() => document.getElementById("source-list")?.getAttribute("aria-busy") === "false", {
    timeout: 20_000,
  });
}

async function prepareSpaces(page: Page) {
  await page.waitForSelector("#space-list", { timeout: 20_000 });
}

async function setDark(page: Page, dark: boolean) {
  await page.evaluate((mode) => {
    document.documentElement.classList.toggle("dark", mode);
    localStorage.setItem("cc-theme", mode ? "dark" : "light");
  }, dark);
}

async function main() {
  await new Promise<void>((resolve, reject) => {
    const build = spawn("pnpm", ["run", "build"], { cwd: serverDir, stdio: "inherit" });
    build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`build ${code}`))));
  });

  const dataDir = await mkdtemp(join(tmpdir(), "cc-view-cleanup-b-"));
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("pnpm", ["exec", "tsx", "scripts/seed-ui-screenshots.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
    seed.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed ${code}`))));
  });

  const port = 3960 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${port}`;
  const app = startAppServer(dataDir, port);
  const outDir = join(repoRoot, "docs/screenshots/view-cleanup-b", prefix);
  const md5s: string[] = [];

  try {
    await waitForServer(baseUrl);
    const browser = await chromium.launch();
    const page = await browser.newPage();
    for (const shot of SHOTS) {
      await page.setViewportSize({ width: shot.width, height: shot.height });
      await page.goto(`${baseUrl}${shot.path}`, { waitUntil: "domcontentloaded" });
      if (shot.prepare) await shot.prepare(page);
      await setDark(page, !!shot.dark);
      await sleep(200);
      const outPath = join(outDir, shot.name);
      await page.screenshot({ path: outPath, fullPage: false });
      const buf = await readFile(outPath);
      const md5 = createHash("md5").update(buf).digest("hex");
      md5s.push(`${shot.name}: ${md5}`);
      console.log("wrote", join("docs/screenshots/view-cleanup-b", prefix, shot.name), md5);
    }
    await browser.close();
    console.log("md5 summary\n" + md5s.join("\n"));
  } finally {
    app.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
