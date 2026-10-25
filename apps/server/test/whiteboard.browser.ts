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

function allowedConsoleNoise(text: string): boolean {
  if (/fonts\.(googleapis|gstatic)\.com/i.test(text)) return true;
  if (text.includes("cf-access-jwt-assertion") && text.includes("CORS")) return true;
  if (text === "Failed to load resource: net::ERR_FAILED") return true;
  if (text.includes("ERR_FAILED") && /font/i.test(text)) return true;
  if (text.includes("net::ERR_ABORTED") && /font/i.test(text)) return true;
  return false;
}

async function assertEditorVisible(page: Page) {
  await page.locator(".excalidraw").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(".excalidraw .App-toolbar").waitFor({ state: "visible", timeout: 30_000 });
  const canvasCount = await page.locator("#whiteboard-root canvas").count();
  assert.ok(canvasCount > 0, "expected at least one Excalidraw canvas");
}

async function drawStrokeWithMouse(page: Page) {
  await assertEditorVisible(page);
  await page.locator(".excalidraw").click();
  const freedrawTool = page.locator(".excalidraw .ToolIcon_type_freedraw");
  if (await freedrawTool.count()) await freedrawTool.first().click();
  else await page.keyboard.press("p");
  const canvas = page.locator("#whiteboard-root canvas").last();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert.ok(box, "canvas has layout");
  const x0 = box.x + box.width * 0.3;
  const y0 = box.y + box.height * 0.45;
  const x1 = box.x + box.width * 0.7;
  const y1 = box.y + box.height * 0.55;
  await page.mouse.move(x0, y0);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(x1, y1, { steps: 20 });
  await page.mouse.up({ button: "left" });
  await page.waitForFunction(
    () => {
      const scene = window.whiteboardEditor?.getScene() as { elements?: unknown[] } | undefined;
      return Array.isArray(scene?.elements) && scene.elements.length > 0;
    },
    undefined,
    { timeout: 15_000 },
  );
}

test("whiteboard renders Excalidraw, saves a drawn stroke, and reloads it", { timeout: 180_000 }, async () => {
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
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "cf-access-jwt-assertion": "owner" },
    });
    await context.addInitScript(() => {
      const sw = navigator.serviceWorker;
      if (!sw) return;
      sw.register = async () => ({}) as ServiceWorkerRegistration;
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
    await page.route("**/sw.js", (route) => route.fulfill({ status: 200, body: "// noop", contentType: "text/javascript" }));

    await page.goto(`${base}/whiteboard`, { waitUntil: "networkidle" });
    assert.equal(
      await page.evaluate(() => document.body.innerText.includes(".agent-tabs{display:flex")),
      false,
      "layout CSS must not render as visible page text",
    );

    await page.getByRole("button", { name: "New board" }).click();
    await page.locator("#whiteboard-list button.ghost").first().waitFor({ timeout: 15_000 });
    await assertEditorVisible(page);

    const saveDone = page.waitForResponse(
      (res) => res.request().method() === "PUT" && /\/api\/whiteboard\/scenes\/[^/]+$/.test(res.url()) && res.ok(),
      { timeout: 25_000 },
    );
    await drawStrokeWithMouse(page);
    await saveDone;
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
    await page.locator("#whiteboard-list button.ghost").first().click();
    await assertEditorVisible(page);
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

    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors.filter((e) => !allowedConsoleNoise(e)), []);
  } finally {
    await browser.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
