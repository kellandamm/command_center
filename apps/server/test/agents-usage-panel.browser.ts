import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "./cf-access-jwt";

const ADMIN_TOKEN = "a".repeat(32);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(baseUrl: string) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) return;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error("server not ready");
}

async function seedDashboard(dataDir: string) {
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("pnpm", ["exec", "tsx", "scripts/seed-dashboard-screenshot.ts"], {
      cwd: join(import.meta.dirname, ".."),
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
    seed.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed ${code}`))));
  });
}

async function openOwnerDashboardServer(dataDir: string) {
  const cfKeys = await createTestCfAccessJwt();
  const cfg = loadConfig({
    DATA_DIR: dataDir,
    ADMIN_TOKEN,
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: TEST_CF_AUD,
    OWNER_EMAILS: "owner@example.com",
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
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ownerJwt = await cfKeys.signEmailJwt("owner@example.com");
  const close = async () => {
    await closeIntegrationServer(server, integration);
  };
  return { base, ownerJwt, close };
}

async function ownerPage(browser: Browser, base: string, ownerJwt: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "CF_Authorization", value: ownerJwt, domain: "127.0.0.1", path: "/" }]);
  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#panel-agents-usage", { timeout: 20_000 });
  await page.waitForFunction(
    () => typeof (window as unknown as { renderAgentsUsagePanel?: unknown }).renderAgentsUsagePanel === "function",
  );
  return page;
}

async function renderPanel(page: Page, data: unknown) {
  await page.evaluate((payload) => {
    (window as unknown as { renderAgentsUsagePanel: (d: unknown) => void }).renderAgentsUsagePanel(payload);
  }, data);
}

test("dashboard toolbar buttons use outline sm styling", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-dash-outline-"));
  await seedDashboard(dataDir);
  const app = await openOwnerDashboardServer(dataDir);
  const browser = await chromium.launch();
  try {
    await waitForServer(app.base);
    const page = await ownerPage(browser, app.base, app.ownerJwt);
    const styles = await page.evaluate(() => {
      const btn = document.getElementById("dashboard-reset-layout");
      if (!btn) return null;
      const cs = getComputedStyle(btn);
      return { classes: btn.className, background: cs.backgroundColor, fontSize: cs.fontSize, minHeight: cs.minHeight };
    });
    assert.ok(styles);
    assert.match(styles!.classes, /btn-outline/);
    assert.match(styles!.classes, /btn-sm/);
    const bg = styles!.background;
    assert.ok(bg === "rgba(0, 0, 0, 0)" || bg === "transparent", `expected transparent outline bg, got ${bg}`);
    assert.ok(parseFloat(styles!.fontSize) < 14);
    assert.ok(parseFloat(styles!.minHeight) <= 33);
  } finally {
    await browser.close();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("agents usage panel client rendering", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-usage-panel-ui-"));
  await seedDashboard(dataDir);
  const app = await openOwnerDashboardServer(dataDir);
  const browser = await chromium.launch();
  try {
    await waitForServer(app.base);
    const page = await ownerPage(browser, app.base, app.ownerJwt);

    await renderPanel(page, {
      latest: { asOf: "2026-10-30T12:00:00.000Z" },
      computed: { weeklyPercentUsed: null, metricsUnavailable: true, resetsAt: "2026-11-02T09:00:00.000Z" },
      byBot: [],
    });
    assert.equal(await page.locator("#panel-agents-usage .agents-usage-panel-pct").textContent(), "Unavailable");
    const fillStyle = await page.locator("#panel-agents-usage .agents-usage-bar-fill").getAttribute("style");
    assert.ok(!fillStyle || !/width:/.test(fillStyle), `unexpected bar fill: ${fillStyle}`);

    await renderPanel(page, {
      latest: { asOf: "2026-10-30T12:00:00.000Z" },
      computed: {
        weeklyPercentUsed: 40,
        readingStale: true,
        lastReadingAgeMs: 27 * 3600000,
        baseline: 35,
        status: "ahead",
        resetsAt: "2026-11-02T09:00:00.000Z",
        resetCountdown: { days: 2, hours: 5 },
        metricsUnavailable: false,
      },
      byBot: [],
    });
    const stale = await page.locator(".agents-usage-stale-banner").textContent();
    assert.ok(stale);
    assert.match(stale, /Stale · last reading/);
    assert.ok(await page.locator(".agents-usage-panel.is-dimmed").count());

    await renderPanel(page, {
      latest: { asOf: "2026-10-24T10:00:00.000Z" },
      computed: {
        weeklyPercentUsed: 80,
        cycleEnded: true,
        cycleEndedMessage: "Reset passed, awaiting new reading",
        resetsAt: "2026-10-24T09:00:00.000Z",
      },
      byBot: [],
    });
    const cycle = await page.locator(".agents-usage-cycle-msg").textContent();
    assert.ok(cycle);
    assert.match(cycle, /awaiting new reading/);

    await renderPanel(page, { _apiError: true, latest: null, computed: {}, byBot: [] });
    assert.equal(await page.locator(".agents-usage-panel-pct").textContent(), "Unavailable");
    assert.equal(await page.locator(".agents-usage-reset").textContent(), "");

    await renderPanel(page, {
      latest: { asOf: "2026-10-30T12:00:00.000Z" },
      computed: { weeklyPercentUsed: 12, metricsUnavailable: true, resetsAt: null, status: "unknown" },
      byBot: [{ name: "<img onerror=alert(1)>", share: 5 }],
    });
    const pctText = await page.locator(".agents-usage-panel-pct").textContent();
    assert.ok(pctText);
    assert.match(pctText, /12%/);
    assert.equal(await page.locator(".agents-usage-reset").textContent(), "Reset unknown");
    assert.equal(await page.locator(".agents-usage-bots li span").first().textContent(), "<img onerror=alert(1)>");
    assert.equal(await page.locator(".agents-usage-bots img").count(), 0);

    await renderPanel(page, {
      latest: { asOf: "2026-10-30T12:00:00.000Z" },
      computed: {
        weeklyPercentUsed: 40,
        metricsUnavailable: false,
        resetsAt: "2026-11-02T09:00:00.000Z",
        resetCountdown: { days: 0, hours: 0 },
        status: "on_pace",
        baseline: 35,
      },
      byBot: [],
    });
    const resetLine = await page.locator(".agents-usage-reset").textContent();
    assert.ok(resetLine);
    assert.match(resetLine, /Resets in <1 h/);
  } finally {
    await browser.close();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("agents usage reset line uses browser local time zone", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-usage-panel-tz-"));
  await seedDashboard(dataDir);
  const app = await openOwnerDashboardServer(dataDir);
  const browser = await chromium.launch();
  try {
    await waitForServer(app.base);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      timezoneId: "America/Los_Angeles",
    });
    await context.addCookies([{ name: "CF_Authorization", value: app.ownerJwt, domain: "127.0.0.1", path: "/" }]);
    const page = await context.newPage();
    await page.goto(`${app.base}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => typeof (window as unknown as { renderAgentsUsagePanel?: unknown }).renderAgentsUsagePanel === "function",
    );
    await renderPanel(page, {
      latest: { asOf: "2026-10-30T12:00:00.000Z" },
      computed: {
        weeklyPercentUsed: 10,
        metricsUnavailable: false,
        resetsAt: "2026-11-02T09:00:00.000Z",
        resetCountdown: { days: 2, hours: 5 },
        status: "on_pace",
        baseline: 8,
      },
      byBot: [],
    });
    const resetLine = await page.locator(".agents-usage-reset").textContent();
    assert.ok(resetLine);
    assert.match(resetLine, /\bPST\b|\bPDT\b/);
    assert.doesNotMatch(resetLine, /UTC/);
    await context.close();
  } finally {
    await browser.close();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function openAdminTokenDashboardServer(dataDir: string) {
  const cfKeys = await createTestCfAccessJwt();
  const cfg = loadConfig({
    DATA_DIR: dataDir,
    ADMIN_TOKEN,
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: TEST_CF_AUD,
    OWNER_EMAILS: "owner@example.com",
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
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    await closeIntegrationServer(server, integration);
  };
  return { base, close };
}

test("voice inbox hides on owner-only 403", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-voice-inbox-403-"));
  await seedDashboard(dataDir);
  const app = await openAdminTokenDashboardServer(dataDir);
  const browser = await chromium.launch();
  try {
    await waitForServer(app.base);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addCookies([{ name: "ah_token", value: ADMIN_TOKEN, domain: "127.0.0.1", path: "/" }]);
    const page = await context.newPage();
    await page.goto(`${app.base}/`, { waitUntil: "networkidle" });
    await page.waitForSelector("#voice-inbox", { state: "attached", timeout: 20_000 });
    await page.waitForFunction(() => {
      const root = document.getElementById("voice-inbox");
      return !!root && root.hidden === true;
    });
    assert.equal(await page.locator(".voice-inbox-unavailable:not([hidden])").count(), 0);
    await context.close();
  } finally {
    await browser.close();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("voice inbox shows unavailable on server error", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-voice-inbox-5xx-"));
  await seedDashboard(dataDir);
  const app = await openOwnerDashboardServer(dataDir);
  const browser = await chromium.launch();
  try {
    await waitForServer(app.base);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addCookies([{ name: "CF_Authorization", value: app.ownerJwt, domain: "127.0.0.1", path: "/" }]);
    const page = await context.newPage();
    await page.route("**/api/voice-captures", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Voice inbox down" }),
      }),
    );
    await page.goto(`${app.base}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".voice-inbox-unavailable:not([hidden])", { timeout: 20_000 });
    const unavailable = await page.locator(".voice-inbox-unavailable").textContent();
    assert.ok(unavailable);
    assert.match(unavailable, /Voice inbox unavailable/);
    await context.close();
  } finally {
    await browser.close();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
