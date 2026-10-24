/**
 * Capture 1280×800 UI screenshots with per-route verification (pathname + page marker).
 *
 * Usage (from apps/server):
 *   pnpm capture:ui-screenshots
 */
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium, type Page } from "playwright";

const serverDir = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = join(serverDir, "../..");
const VIEWPORT = { width: 1280, height: 800 };

type Shot = {
  out: string;
  path: string;
  /** Must match document.title or h1 text (case-insensitive substring). */
  marker: string;
  prepare?: (page: Page) => Promise<void>;
  /** Screenshot a sub-element instead of the viewport. */
  clipSelector?: string;
};

const SETTINGS_SHOTS: Shot[] = [
  {
    out: "docs/screenshots/settings-tabs/dashboard-1280x800.png",
    path: "/",
    marker: "Dashboard",
    prepare: async (page) => {
      await page.waitForSelector("#dashboard-grid", { timeout: 15_000 });
      await page.waitForSelector("#panel-tasks", { timeout: 15_000 });
    },
  },
  {
    out: "docs/screenshots/settings-tabs/settings-schedule-1280x800.png",
    path: "/settings",
    marker: "Settings",
    prepare: async (page) => {
      await page.click('.settings-tabs button[data-tab="schedule"]');
      await page.waitForSelector("#tab-schedule.on #briefingTime", { timeout: 15_000 });
    },
  },
  {
    out: "docs/screenshots/settings-tabs/settings-tabs-1280x800.png",
    path: "/settings",
    marker: "Settings",
    prepare: async (page) => {
      await page.click('.settings-tabs button[data-tab="tabs"]');
      await page.waitForSelector("#tab-tabs.on #tabs-editor input.tab-label", { timeout: 15_000 });
    },
  },
  {
    out: "docs/screenshots/settings-tabs/board-1280x800.png",
    path: "/agent?view=board",
    marker: "Board",
    prepare: async (page) => {
      await page.waitForSelector(".board-col-list .board-card", { timeout: 15_000 });
      await page.waitForSelector('[data-column="Ready for Hobie"] .board-card', { timeout: 15_000 });
    },
  },
  {
    out: "docs/screenshots/settings-tabs/wins-1280x800.png",
    path: "/agent?view=wins",
    marker: "Wins",
    prepare: async (page) => {
      await page.waitForSelector(".wins-week", { timeout: 15_000 });
    },
  },
  {
    out: "docs/screenshots/settings-tabs/briefing-board-1280x800.png",
    path: "/briefing",
    marker: "Briefing",
    prepare: async (page) => {
      await page.waitForSelector("#db-topics-body", { timeout: 15_000 });
      await page.locator("#db-topics").scrollIntoViewIfNeeded();
    },
  },
  {
    out: "docs/screenshots/settings-tabs/activity-1280x800.png",
    path: "/agent?view=activity",
    marker: "Activity",
    prepare: async (page) => {
      await page.waitForSelector("#activity-full-list li", { timeout: 15_000 });
    },
  },
  {
    out: "docs/screenshots/settings-tabs/calendar-1280x800.png",
    path: "/calendar",
    marker: "Calendar",
    prepare: async (page) => {
      await page.waitForSelector("#cal-week-grid", { timeout: 15_000 });
      await page.waitForSelector("#calendar-status-full", { timeout: 15_000 });
    },
  },
  {
    out: "docs/screenshots/settings-tabs/notes-1280x800.png",
    path: "/notes",
    marker: "Notes",
    prepare: async (page) => {
      await page.waitForSelector("#knowledge-note-list", { timeout: 15_000 });
    },
  },
];

const DASHBOARD_V1_SHOTS: Shot[] = [
  {
    out: "docs/screenshots/dashboard-v1/dashboard-1280x800.png",
    path: "/",
    marker: "Dashboard",
    prepare: async (page) => {
      await page.waitForSelector("#panel-tasks #tasks-list li", { timeout: 20_000 });
      await page.waitForSelector("#panel-attention .attention-reason", { timeout: 20_000 });
      await page.waitForSelector("#panel-heatmap .heatmap-cell.level-1, #panel-heatmap .heatmap-cell.level-2", { timeout: 20_000 });
      await page.waitForSelector("#panel-launchpad .launchpad-tile", { timeout: 20_000 });
    },
  },
  {
    out: "docs/screenshots/dashboard-v1/attention-1280x800.png",
    path: "/",
    marker: "Dashboard",
    clipSelector: '.dashboard-item[data-panel-id="attention"]',
    prepare: async (page) => {
      await page.waitForFunction(() => document.querySelectorAll(".attention-block h3").length >= 4);
      await page.getByRole("heading", { name: "On this day" }).waitFor({ timeout: 20_000 });
      await page.getByRole("heading", { name: "Rediscover" }).waitFor({ timeout: 20_000 });
      await page.locator('.dashboard-item[data-panel-id="attention"]').scrollIntoViewIfNeeded();
    },
  },
  {
    out: "docs/screenshots/dashboard-v1/attention-panel.png",
    path: "/",
    marker: "Dashboard",
    clipSelector: "#panel-attention .attention-sections",
    prepare: async (page) => {
      await page.waitForSelector("#panel-attention .attention-controls", { timeout: 20_000 });
      await page.locator("#panel-attention").scrollIntoViewIfNeeded();
    },
  },
  {
    out: "docs/screenshots/dashboard-v1/dashboard-mobile-390x844.png",
    path: "/",
    marker: "Dashboard",
    prepare: async (page) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForSelector("#dashboard-grid .dashboard-item", { timeout: 20_000 });
      await page.waitForSelector("#panel-tasks", { timeout: 20_000 });
    },
  },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(baseUrl: string, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${baseUrl}/healthz`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error(`Server did not become ready at ${baseUrl}`);
}

async function assertPageMarker(page: Page, path: string, marker: string) {
  const url = new URL(page.url());
  const expectedPath = new URL(path, url.origin).pathname;
  if (url.pathname !== expectedPath) {
    throw new Error(`Wrong path for ${path}: got ${url.pathname} (full ${page.url()})`);
  }
  const h1 = (await page.locator("h1").first().textContent())?.trim() ?? "";
  const title = await page.title();
  const hay = `${h1} ${title}`.toLowerCase();
  if (!hay.includes(marker.toLowerCase())) {
    throw new Error(`Page marker "${marker}" not found for ${path} (h1="${h1}", title="${title}")`);
  }
}

async function captureShot(page: Page, baseUrl: string, shot: Shot) {
  await page.goto(`${baseUrl}${shot.path}`, { waitUntil: "domcontentloaded" });
  if (shot.prepare) await shot.prepare(page);
  await assertPageMarker(page, shot.path, shot.marker);
  const outPath = join(repoRoot, shot.out);
  if (shot.clipSelector) {
    await page.locator(shot.clipSelector).screenshot({ path: outPath });
  } else {
    await page.screenshot({ path: outPath, fullPage: false });
  }
  console.log("wrote", shot.out);
}

function startAppServer(dataDir: string, port: number, icsLocalFile: string): ChildProcess {
  return spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      HOST: "127.0.0.1",
      PORT: String(port),
      ALLOW_INSECURE_NO_AUTH: "1",
      TZ: "UTC",
      ICS_LOCAL_FILES: icsLocalFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function runCapture(shots: Shot[], seedScript: string, icsLocalFile?: string) {
  await new Promise<void>((resolve, reject) => {
    const build = spawn("pnpm", ["run", "build"], { cwd: serverDir, stdio: "inherit" });
    build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`build exited ${code}`))));
  });
  const dataDir = await mkdtemp(join(tmpdir(), "cc-ui-shot-"));
  console.log("seeding", dataDir, "via", seedScript);
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("pnpm", ["exec", "tsx", seedScript], {
      cwd: serverDir,
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
    seed.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
  });

  const appPort = 3847 + Math.floor(Math.random() * 500);
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const app = startAppServer(dataDir, appPort, icsLocalFile ?? join(serverDir, "test/fixtures/demo-week.ics"));
  app.stderr?.on("data", (d) => process.stderr.write(d));
  try {
    await waitForServer(baseUrl);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: VIEWPORT });
    for (const shot of shots) {
      if (shot.out.includes("dashboard-mobile")) {
        await page.setViewportSize({ width: 390, height: 844 });
      } else {
        await page.setViewportSize(VIEWPORT);
      }
      await captureShot(page, baseUrl, shot);
    }
    await browser.close();

    const { createHash } = await import("node:crypto");
    const hashes = new Map<string, string>();
    for (const shot of shots) {
      const buf = await readFile(join(repoRoot, shot.out));
      const h = createHash("sha256").update(buf).digest("hex").slice(0, 16);
      if (hashes.has(h)) {
        throw new Error(`Duplicate screenshot bytes: ${shot.out} matches another file (${hashes.get(h)})`);
      }
      hashes.set(h, shot.out);
    }
    console.log("all screenshots unique (" + shots.length + " files)");
  } finally {
    app.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function main() {
  await runCapture(SETTINGS_SHOTS, "scripts/seed-ui-screenshots.ts");
  await runCapture(DASHBOARD_V1_SHOTS, "scripts/seed-dashboard-screenshot.ts");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
