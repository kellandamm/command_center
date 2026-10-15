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
  /** Screenshot a sub-element instead of the viewport (e.g. news workspace). */
  clipSelector?: string;
};

const SETTINGS_SHOTS: Shot[] = [
  {
    out: "docs/screenshots/settings-tabs/dashboard-1280x800.png",
    path: "/",
    marker: "Dashboard",
    prepare: async (page) => {
      await page.waitForSelector(".dashboard-overview", { timeout: 15_000 });
      await page.waitForSelector("#dashboard-hobie-count", { timeout: 15_000 });
    },
  },
  {
    out: "docs/screenshots/settings-tabs/settings-schedule-1280x800.png",
    path: "/settings",
    marker: "Settings",
    prepare: async (page) => {
      await page.click('.settings-tabs button[data-tab="schedule"]');
      await page.waitForSelector("#tab-schedule.on #scope-all", { timeout: 15_000 });
      await page.waitForSelector("#scope-folder-list label.choice-row", { timeout: 15_000 });
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
    path: "/board",
    marker: "Board",
    prepare: async (page) => {
      await page.waitForSelector(".board-col-list .board-card", { timeout: 15_000 });
      await page.waitForSelector('[data-column="Ready for Hobie"] .board-card', { timeout: 15_000 });
    },
  },
  {
    out: "docs/screenshots/settings-tabs/wins-1280x800.png",
    path: "/wins",
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
      await page.waitForSelector("#db-board-blocked-body li", { timeout: 15_000 });
      await page.waitForSelector("#db-board-wins-body li", { timeout: 15_000 });
      await page.locator("#db-board-blocked").scrollIntoViewIfNeeded();
    },
  },
  {
    out: "docs/screenshots/settings-tabs/activity-1280x800.png",
    path: "/activity",
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
      await page.waitForSelector("#cal-week-grid .cal-day", { timeout: 15_000 });
      await page.waitForSelector("#cal-week-grid .cal-ev", { timeout: 15_000 });
      const status = await page.locator("#calendar-status-full").textContent();
      if (!status || !/\d+ events/.test(status)) throw new Error("Calendar has no events: " + status);
    },
  },
  {
    out: "docs/screenshots/settings-tabs/notes-1280x800.png",
    path: "/notes",
    marker: "Notes",
    prepare: async (page) => {
      await page.waitForSelector("#notes-editor-full", { timeout: 15_000 });
    },
  },
];

const RSS_SHOT: Shot = {
  out: "docs/screenshots/rss-reader/grouped-tree-1280x800.png",
  path: "/news",
  marker: "News",
  prepare: async (page) => {
    await page.waitForSelector("#rss-tree .tree-folder-row", { timeout: 15_000 });
    await page.waitForSelector("#rss-tree .tree-feed-row", { timeout: 15_000 });
    await page.click("#rss-organize");
    await page.waitForSelector("#rss-tree.organize .tree-folder-actions .tree-act", { timeout: 15_000 });
    await page.locator("#rss-tree .tree-folder-row").first().scrollIntoViewIfNeeded();
  },
  clipSelector: ".rss-workspace",
};

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
  if (url.pathname !== path) {
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

async function main() {
  const onlyRss = process.argv.includes("--rss-only");
  const shots = onlyRss ? [RSS_SHOT] : [...SETTINGS_SHOTS, RSS_SHOT];

  const dataDir = await mkdtemp(join(tmpdir(), "cc-ui-shot-"));
  const icsPath = join(serverDir, "test/fixtures/demo-week.ics");

  console.log("seeding", dataDir);
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("pnpm", ["exec", "tsx", "scripts/seed-ui-screenshots.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
    seed.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
  });

  const appPort = 3847 + Math.floor(Math.random() * 500);
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const app = startAppServer(dataDir, appPort, icsPath);
  app.stderr?.on("data", (d) => process.stderr.write(d));
  try {
    await waitForServer(baseUrl);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: VIEWPORT });
    for (const shot of shots) {
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
