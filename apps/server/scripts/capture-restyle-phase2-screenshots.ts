/**
 * Phase 2 restyle before/after: Bookmarks, Calendar, Notes, Settings (1440 + 390, light + dark).
 * Usage: pnpm exec tsx scripts/capture-restyle-phase2-screenshots.ts [--before|--after]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
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
const outRoot = join(repoRoot, "docs/screenshots/restyle/phase2", mode);

type Shot = {
  name: string;
  path: string;
  marker: string;
  viewport: { width: number; height: number };
  theme?: "light" | "dark";
  prepare?: (page: Page) => Promise<void>;
};

const PAGES = ["bookmarks", "calendar", "notes", "settings"] as const;

async function waitForNotesEditorReady(p: Page) {
  await p.waitForSelector("#knowledge-note-list", { timeout: 25_000 });
  await p.waitForFunction(
    () => {
      const w = window as unknown as { notesEditor?: { load?: (body: string) => boolean } };
      return typeof w.notesEditor?.load === "function";
    },
    { timeout: 30_000 },
  );
  await p.waitForFunction(
    () => {
      const warn = document.getElementById("knowledge-editor-warning");
      const text = warn?.textContent ?? "";
      return !text.includes("Formatted editor could not load");
    },
    { timeout: 30_000 },
  );
  await p.waitForFunction(
    () => document.getElementById("knowledge-writing")?.dataset.mode === "write",
    { timeout: 15_000 },
  );
}

function shotsFor(page: (typeof PAGES)[number], route: string, marker: string, prepare: (p: Page) => Promise<void>): Shot[] {
  const base = { path: route, marker, prepare };
  return [
    { name: `${page}-1440-light`, viewport: { width: 1440, height: 900 }, ...base },
    {
      name: `${page}-1440-dark`,
      viewport: { width: 1440, height: 900 },
      theme: "dark",
      ...base,
      prepare: async (p) => {
        await p.evaluate(() => {
          document.documentElement.classList.add("dark");
          localStorage.setItem("cc-theme", "dark");
        });
        await prepare(p);
      },
    },
    { name: `${page}-390-light`, viewport: { width: 390, height: 844 }, ...base },
    {
      name: `${page}-390-dark`,
      viewport: { width: 390, height: 844 },
      theme: "dark",
      ...base,
      prepare: async (p) => {
        await p.evaluate(() => {
          document.documentElement.classList.add("dark");
          localStorage.setItem("cc-theme", "dark");
        });
        await prepare(p);
      },
    },
  ];
}

const SHOTS: Shot[] = [
  ...shotsFor("bookmarks", "/bookmarks", "Bookmarks", async (p) => {
    await p.waitForSelector("#bookmark-groups", { timeout: 20_000 });
  }),
  ...shotsFor("calendar", "/calendar", "Calendar", async (p) => {
    await p.waitForSelector("#cal-mini", { timeout: 25_000 });
  }),
  ...shotsFor("notes", "/notes", "Notes", waitForNotesEditorReady),
  ...shotsFor("settings", "/settings", "Settings", async (p) => {
    await p.waitForSelector("#settings-features-list", { timeout: 20_000 });
  }),
  {
    name: "settings-views-subtabs-1440-light",
    path: "/settings",
    marker: "Settings",
    viewport: { width: 1440, height: 900 },
    prepare: async (p) => {
      await p.waitForSelector("#settings-tab-views", { timeout: 20_000 });
      await p.click("#settings-tab-views");
      await p.waitForSelector(".settings-subtabs", { timeout: 10_000 });
    },
  },
];

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
  console.log("capture phase2", mode, "git", gitSha);
  await writeFile(join(outRoot, "git-sha.txt"), `${gitSha}\n`, "utf8");

  await new Promise<void>((resolve, reject) => {
    const build = spawn("pnpm", ["run", "build"], { cwd: serverDir, stdio: "inherit" });
    build.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`build ${c}`))));
  });

  const dataDir = await mkdtemp(join(tmpdir(), "cc-phase2-cap-"));
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("pnpm", ["exec", "tsx", "scripts/seed-ui-screenshots.ts"], {
      cwd: serverDir,
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
    seed.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`seed ${c}`))));
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
    await writeFile(
      join(outRoot, "README.md"),
      `# Phase 2 restyle ${mode} screenshots\n\nBookmarks, Calendar, Notes, Settings at 1440×900 and 390×844 (light + dark).\n\nGit commit: see \`git-sha.txt\`.\n`,
    );
  } finally {
    await closeServer();
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
