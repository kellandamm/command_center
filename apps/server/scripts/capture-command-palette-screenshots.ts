/**
 * Command palette screenshots (light + dark) at 1440 and 390 widths.
 * Usage: pnpm exec tsx scripts/capture-command-palette-screenshots.ts
 */
import { mkdir } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { SettingsStore } from "../src/settings";
import { NotesStore } from "../src/notes/store";
import { openIntegrationStores, closeIntegrationServer } from "../test/helpers";
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "../test/cf-access-jwt";

const serverDir = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const outRoot = join(serverDir, "../../docs/screenshots/command-palette");

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-cp-shots-"));
  const cfKeys = await createTestCfAccessJwt();
  const cfg = loadConfig({
    DATA_DIR: dataDir,
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: TEST_CF_AUD,
    OWNER_EMAILS: "owner@example.com",
    TZ: "UTC",
  });
  const settings = new SettingsStore(dataDir);
  await settings.load();
  const notes = await NotesStore.open(dataDir);
  await notes.createNote({ title: "Palette demo note", content: "Screenshot seed content." });
  const integration = await openIntegrationStores(dataDir, cfg);
  const dailyBriefing = await DailyBriefingService.open(dataDir, cfg.tz);
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
  const jwt = await cfKeys.signEmailJwt("owner@example.com");
  await mkdir(join(outRoot, "before"), { recursive: true });
  await mkdir(join(outRoot, "after"), { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const phase of ["before", "after"] as const) {
      for (const [file, width, dark] of [
        ["command-palette-1440-light.png", 1440, false],
        ["command-palette-1440-dark.png", 1440, true],
        ["command-palette-390-light.png", 390, false],
        ["command-palette-390-dark.png", 390, true],
      ] as const) {
        const context = await browser.newContext({
          viewport: { width, height: dark ? 900 : 800 },
          colorScheme: dark ? "dark" : "light",
        });
        await context.addCookies([
          { name: "CF_Authorization", value: jwt, domain: "127.0.0.1", path: "/" },
        ]);
        const page = await context.newPage();
        await page.goto(`${base}/`);
        await page.waitForSelector(".app-shell");
        if (dark) {
          await page.evaluate(() => document.documentElement.classList.add("dark"));
        } else {
          await page.evaluate(() => document.documentElement.classList.remove("dark"));
        }
        const shotPath = join(outRoot, phase, file);
        if (phase === "before") {
          await page.screenshot({ path: shotPath, fullPage: false });
        } else {
          await page.keyboard.press("Control+k");
          await page.waitForSelector("#command-palette-overlay.open");
          await page.fill("#command-palette-input", "demo");
          await page.waitForSelector(".command-palette-option");
          await page.screenshot({ path: shotPath, fullPage: false });
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await closeIntegrationServer(server, integration);
  }
  console.log("Wrote screenshots to", outRoot);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
