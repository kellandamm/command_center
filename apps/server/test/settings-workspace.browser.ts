import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { settingsPage } from "../src/ui/pages";
import { connectionsPage } from "../src/ui/connections-page";
import { calendarSettingsPage } from "../src/ui/calendar-settings-page";
import { capturePage } from "../src/ui/capture-page";
import { ConnectionsStore } from "../src/connections";
import { loadConfig } from "../src/config";
import { DEFAULT_SETTINGS } from "../src/settings";

test("Settings workspace: all categories fit desktop/mobile, light/dark and zoom-equivalent widths", { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "settings-visual-"));
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const cfg = loadConfig({ DATA_DIR: dir, CONNECTIONS_MASTER_KEY: "a".repeat(64), LLM_BASE_URL: "https://models.example/v1", LLM_MODEL: "example-model", LLM_API_KEY: "fake-fixture-secret", BRAVE_SEARCH_API_KEY: "fake-fixture-secret" });
    const connections = await ConnectionsStore.open(cfg);
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname !== "workspace.test") return route.abort();
      const pages: Record<string, () => string> = { "/settings": settingsPage, "/settings/connections": connectionsPage, "/settings/calendars": calendarSettingsPage, "/settings/capture": capturePage };
      if (pages[url.pathname]) return route.fulfill({ contentType: "text/html", body: pages[url.pathname]!() });
      if (url.pathname === "/api/settings") return route.fulfill({ json: {
        settings: DEFAULT_SETTINGS, revision: "fixture-revision",
        meta: { canManage: true, ownerEmailsConfigured: true, connectionsStorage: true, features: { whiteboardEnabled: false, shareLinksEnabled: true } },
        briefingProviders: { search: true, summarizer: true }, ntfy: { enabled: false, quietHours: "22:00-07:00", reminderMinutes: 10, coachEnabled: false },
        runtime: {
          timezone: "America/Chicago", version: "fixture-build",
          weather: { provider: "Open-Meteo", latitude: 41.8781, longitude: -87.6298 }, githubUsername: "example-author",
          integrations: { github: false, todoist: false, recallio: false, docker: false },
          calendar: { native: 1, subscriptions: 0, environmentFeeds: 0 },
          access: { cloudflare: true, adminToken: false, insecureNoAuth: false, canManageConnections: true, encryptedStorage: true },
          agents: { mcpClients: 1, cloudflareClients: 0, webhook: false, hobiePoll: true, maxPendingTasks: 20 },
        },
      } });
      if (url.pathname === "/api/connections") return route.fulfill({ json: connections.status() });
      if (url.pathname === "/api/capture/access") return route.fulfill({ json: { configured: true } });
      if (url.pathname === "/api/calendars") return route.fulfill({ json: { calendars: [{ id: "work", name: "Work", kind: "native", enabled: true, sharing: false, version: 1 }], canManage: true, credentialsWritable: true, timezone: "America/Chicago", google: { configured: false } } });
      assert.equal(request.method(), "GET", "Visual inspection must not send real mutations or provider tests");
      return route.fulfill({ status: 404 });
    });
    const surfaces = [
      ["general", "/settings#general"], ["appearance", "/settings#appearance"], ["briefing", "/settings#briefing"],
      ["connections", "/settings/connections"], ["calendars", "/settings/calendars"],
      ["notifications", "/settings#notifications"], ["capture", "/settings/capture"], ["advanced", "/settings#advanced"],
      ["connection-detail", "/settings/connections#llm"],
    ];
    if (process.env.SETTINGS_SCREENSHOT_DIR) await mkdir(process.env.SETTINGS_SCREENSHOT_DIR, { recursive: true });
    for (const width of [1440, 390, 720]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        for (const [name, path] of surfaces) {
          await page.goto("http://workspace.test" + path);
          if (path!.includes("connections")) await page.locator('[data-connection-id="llm"]').waitFor();
          else if (name === "calendars") await page.locator('[data-calendar-id="work"]').waitFor();
          else if (name === "capture") await page.getByText("A capture token is active. Its value cannot be retrieved.", { exact: true }).waitFor();
          else await page.waitForFunction(() => !(document.getElementById("settings-editor") as HTMLFieldSetElement).disabled);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${name}, ${width}, ${theme}`);
          if (name === "connections") {
            assert.equal(await page.locator(".connection-summary>button").evaluateAll((buttons) => buttons.every((button) => getComputedStyle(button).whiteSpace === "nowrap")), true);
          }
          if (name === "connection-detail") {
            assert.equal(await page.locator(".connection-fields input[type=checkbox]").first().evaluate((input) => input.getBoundingClientRect().width < 30), true);
          }
          if (name === "general") {
            const colors = await page.locator("#settings-category-description").evaluate((text) => {
              let parent: Element | null = text;
              while (parent && ["rgba(0, 0, 0, 0)", "transparent"].includes(getComputedStyle(parent).backgroundColor)) parent = parent.parentElement;
              return { foreground: getComputedStyle(text).color, background: getComputedStyle(parent!).backgroundColor };
            });
            const luminance = (color: string) => {
              const values = color.match(/[\d.]+/g)!.map(Number).slice(0, 3).map((value) => color.includes("srgb") ? value : value / 255);
              return values.map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
            };
            const foreground = luminance(colors.foreground), background = luminance(colors.background);
            const contrast = (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
            assert.ok(contrast >= 4.5, `Secondary text contrast ${contrast.toFixed(2)}:1, ${theme}`);
          }
          if (process.env.SETTINGS_SCREENSHOT_DIR && width !== 720) await page.screenshot({ path: join(process.env.SETTINGS_SCREENSHOT_DIR, `${name}-${width}-${theme}.png`), fullPage: true });
        }
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});
