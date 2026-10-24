import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { chromium, type Page } from "playwright";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

async function addStroke(page: Page) {
  await page.waitForFunction(() => typeof window.whiteboardEditor !== "undefined", undefined, { timeout: 30_000 });
  await page.evaluate(() => {
    window.whiteboardEditor!.loadScene({
      type: "excalidraw",
      version: 2,
      source: "command-center",
      elements: [
        {
          id: "stroke-1",
          type: "freedraw",
          x: 120,
          y: 140,
          width: 160,
          height: 90,
          points: [[0, 0], [80, 45], [160, 90]],
        },
      ],
      appState: {},
      files: {},
    });
    document.dispatchEvent(new CustomEvent("whiteboard:change"));
  });
  await page.waitForFunction(
    () => {
      const scene = window.whiteboardEditor?.getScene() as { elements?: unknown[] } | undefined;
      return Array.isArray(scene?.elements) && scene.elements.length > 0;
    },
    undefined,
    { timeout: 15_000 },
  );
}

function regressionConsoleErrors(messages: string[]): string[] {
  return messages.filter(
    (e) =>
      e.includes(".agent-tabs{display:flex")
      || e.includes("MIME type ('application/json')")
      || e.includes("Refused to apply style")
      || e.includes("Refused to execute script"),
  );
}

test("whiteboard page loads editor assets, saves strokes, and has no leaked layout CSS", { timeout: 180_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-whiteboard-browser-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: "w".repeat(32),
    OWNER_EMAILS: "owner@example.com",
    TZ: "UTC",
    WHITEBOARD_ENABLED: "true",
  });
  const integration = await openIntegrationStores(dir, cfg);
  const notes = await NotesStore.open(dir);
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const server = createApp({
    cfg,
    ...integration,
    notes,
    settings,
    dailyBriefing,
    auth: makeAuthenticator(cfg, async (jwt) => ({ email: jwt === "owner" ? "owner@example.com" : "reader@example.com" })),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "cf-access-jwt-assertion": "owner" },
    });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
    await page.goto(`${base}/whiteboard`, { waitUntil: "networkidle" });
    const leakedLayoutCss = await page.evaluate(() => document.body.innerText.includes(".agent-tabs{display:flex"));
    assert.equal(leakedLayoutCss, false, "layout CSS must not render as visible page text");
    await page.getByRole("button", { name: "New board" }).click();
    await page.waitForFunction(() => document.querySelector("#whiteboard-list button.ghost"), undefined, { timeout: 15_000 });
    await addStroke(page);
    await page.waitForFunction(
      () => (document.getElementById("whiteboard-status")?.textContent ?? "").includes("Saved"),
      undefined,
      { timeout: 20_000 },
    );
    const elementCountBefore = await page.evaluate(() => {
      const scene = window.whiteboardEditor?.getScene() as { elements?: unknown[] };
      return scene?.elements?.length ?? 0;
    });
    assert.ok(elementCountBefore > 0);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(
      () => {
        const scene = window.whiteboardEditor?.getScene() as { elements?: unknown[] } | undefined;
        return Array.isArray(scene?.elements) && scene.elements.length > 0;
      },
      undefined,
      { timeout: 30_000 },
    );
    const elementCountAfter = await page.evaluate(() => {
      const scene = window.whiteboardEditor?.getScene() as { elements?: unknown[] };
      return scene?.elements?.length ?? 0;
    });
    assert.equal(elementCountAfter, elementCountBefore);
    assert.deepEqual(regressionConsoleErrors(consoleErrors), []);
  } finally {
    await browser.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
