import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { SettingsStore } from "../src/settings";
import { NotesStore } from "../src/notes/store";
import { BudgetStore } from "../src/budget/store";
import { budgetAvailable } from "../src/budget/gate";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "./cf-access-jwt";

async function openPaletteServer(viewerEmail?: string) {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-cp-browser-"));
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
  const dailyBriefing = await DailyBriefingService.open(dataDir, cfg.tz);
  const notes = await NotesStore.open(dataDir);
  const integration = await openIntegrationStores(dataDir, cfg);
  const budget = budgetAvailable(cfg) ? BudgetStore.open(dataDir) : undefined;
  if (budget) {
    const acct = budget.createAccount({ name: "Checking", type: "checking" });
    budget.commitImport({
      accountId: acct.id,
      fileName: "x.csv",
      fileSha256: "sha",
      mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD", amountColumn: "Amount" },
      invertSign: false,
      rows: [
        {
          rowNumber: 2,
          date: "2026-01-01",
          amountCents: -10,
          payee: "BrowserBudgetPayee",
          memo: "",
          categoryId: null,
          fingerprint: "fp-browser",
        },
      ],
    });
  }
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async (token) => cfKeys.verifier(token)),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ownerJwt = await cfKeys.signEmailJwt("owner@example.com");
  const viewerJwt = await cfKeys.signEmailJwt(viewerEmail ?? "viewer@example.com");
  const close = async () => {
    budget?.close();
    await closeIntegrationServer(server, integration);
    await rm(dataDir, { recursive: true, force: true });
  };
  return { base, ownerJwt, viewerJwt, close };
}

async function withBrowser(fn: (browser: Browser) => Promise<void>) {
  const browser = await chromium.launch();
  try {
    await fn(browser);
  } finally {
    await browser.close();
  }
}

async function withPage(app: Awaited<ReturnType<typeof openPaletteServer>>, fn: (page: Page) => Promise<void>) {
  await withBrowser(async (browser) => {
    const context = await browser.newContext();
    try {
      await context.addCookies([
        { name: "CF_Authorization", value: app.ownerJwt, domain: "127.0.0.1", path: "/" },
      ]);
      const page = await context.newPage();
      await fn(page);
    } finally {
      await context.close();
    }
  });
}

async function openPalette(page: Page) {
  await page.keyboard.press("Control+k");
  await page.waitForSelector("#command-palette-overlay.open", { timeout: 8000 });
}

async function assertActiveDescendant(page: Page, index: number) {
  await page.waitForFunction(
    (expected) => {
      const input = document.getElementById("command-palette-input");
      if (!input || document.activeElement !== input) return false;
      const id = input.getAttribute("aria-activedescendant");
      return id === `command-palette-option-${expected}`;
    },
    index,
  );
}

async function useNotesSourceEditor(page: Page) {
  await page.locator('[data-note-mode="source"]').click();
  await page.waitForSelector("#knowledge-body", { state: "visible" });
}

async function focusNotesRichEditor(page: Page) {
  await page.locator('[data-note-mode="write"]').click();
  const editor = page.locator("#knowledge-editor [contenteditable=true]").first();
  await editor.waitFor({ state: "visible" });
  await editor.click();
  return editor;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

test("command palette browser: open, trap, arrows, enter, esc restores focus", { timeout: 120_000 }, async () => {
  const app = await openPaletteServer();
  try {
    await withPage(app, async (page) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${app.base}/`);
      await page.waitForSelector("#sidebar-toggle");
      await page.locator("#sidebar-toggle").focus();
      const priorId = "sidebar-toggle";
      await openPalette(page);
      assert.equal(await page.evaluate(() => document.querySelector(".sidebar-inset")?.hasAttribute("inert")), true);
      await page.fill("#command-palette-input", "e");
      await page.waitForFunction(() => document.querySelectorAll(".command-palette-option").length >= 4);
      const rowCount = await page.locator(".command-palette-option").count();
      assert.ok(rowCount >= 4);
      await page.keyboard.press("ArrowDown");
      await assertActiveDescendant(page, 1);
      await page.keyboard.press("ArrowDown");
      await assertActiveDescendant(page, 2);
      await page.keyboard.press("ArrowDown");
      await assertActiveDescendant(page, Math.min(3, rowCount - 1));
      await page.keyboard.press("ArrowUp");
      await assertActiveDescendant(page, Math.min(2, rowCount - 1));
      await page.keyboard.press("End");
      await assertActiveDescendant(page, rowCount - 1);
      await page.keyboard.press("Home");
      await assertActiveDescendant(page, 0);
      await page.keyboard.type("s");
      await page.waitForFunction(() => document.activeElement?.id === "command-palette-input");
      await page.waitForFunction(
        () =>
          document.getElementById("command-palette-input")?.getAttribute("aria-activedescendant") ===
          "command-palette-option-0",
        undefined,
        { timeout: 8000 },
      );
      await page.fill("#command-palette-input", "Settings");
      await page.waitForFunction(() => document.querySelectorAll(".command-palette-option").length > 0);
      await page.keyboard.press("ArrowDown");
      await assertActiveDescendant(page, 1);
      await page.keyboard.press("Enter");
      await page.waitForURL(/\/settings/, { timeout: 8000 });
      await page.goto(`${app.base}/`);
      await page.locator("#sidebar-toggle").focus();
      await openPalette(page);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("command-palette-overlay")?.classList.contains("open"));
      await page.waitForFunction((expected) => document.activeElement?.id === expected, priorId);
    });
  } finally {
    await app.close();
  }
});

test("command palette browser: inert on sidebar-inset survives viewport resize while open", { timeout: 120_000 }, async () => {
  const app = await openPaletteServer();
  try {
    await withPage(app, async (page) => {
      await page.setViewportSize({ width: 1440, height: 800 });
      await page.goto(`${app.base}/`);
      await page.waitForSelector(".app-shell");
      await openPalette(page);
      assert.equal(await page.evaluate(() => document.querySelector(".sidebar-inset")?.hasAttribute("inert")), true);
      await page.setViewportSize({ width: 390, height: 800 });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => document.querySelector(".sidebar-inset")?.hasAttribute("inert")), true);
      await page.setViewportSize({ width: 1440, height: 800 });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => document.querySelector(".sidebar-inset")?.hasAttribute("inert")), true);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("command-palette-overlay")?.classList.contains("open"));
      assert.equal(await page.evaluate(() => document.querySelector(".sidebar-inset")?.hasAttribute("inert")), false);
    });
  } finally {
    await app.close();
  }
});

test("command palette browser: mobile to desktop resize keeps inert until close", { timeout: 120_000 }, async () => {
  const app = await openPaletteServer();
  try {
    await withPage(app, async (page) => {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.goto(`${app.base}/`);
      await page.waitForSelector(".app-shell");
      await openPalette(page);
      assert.equal(await page.evaluate(() => document.querySelector(".sidebar-inset")?.hasAttribute("inert")), true);
      await page.setViewportSize({ width: 1440, height: 800 });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => document.querySelector(".sidebar-inset")?.hasAttribute("inert")), true);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("command-palette-overlay")?.classList.contains("open"));
      assert.equal(await page.evaluate(() => document.querySelector(".sidebar-inset")?.hasAttribute("inert")), false);
    });
  } finally {
    await app.close();
  }
});

test("command palette browser: XSS title renders as text not HTML", { timeout: 120_000 }, async () => {
  const app = await openPaletteServer();
  try {
    await withPage(app, async (page) => {
      await page.goto(`${app.base}/`);
      await page.waitForSelector(".app-shell");
      const payload = '<img src=x onerror=alert(1)>';
      await page.evaluate(async (title) => {
        await fetch("/api/knowledge/notes", {
          method: "POST",
          headers: { "content-type": "application/json", "x-ah": "1" },
          body: JSON.stringify({ title, content: "xss seed", tags: [] }),
        });
      }, payload);
      await openPalette(page);
      await page.fill("#command-palette-input", "onerror");
      await page.waitForSelector(".command-palette-option");
      const safe = await page.evaluate(() => ({
        imgs: document.querySelectorAll("#command-palette-listbox img").length,
        titleText: document.querySelector(".command-palette-option-title")?.textContent ?? "",
      }));
      assert.equal(safe.imgs, 0);
      assert.ok(safe.titleText.includes("<img"));
    });
  } finally {
    await app.close();
  }
});

test("command palette browser: non-owner has no budget hits or Budget nav", { timeout: 120_000 }, async () => {
  const app = await openPaletteServer();
  try {
    await withBrowser(async (browser) => {
      const context = await browser.newContext();
      try {
        await context.addCookies([
          { name: "CF_Authorization", value: app.viewerJwt, domain: "127.0.0.1", path: "/" },
        ]);
        const page = await context.newPage();
        await page.goto(`${app.base}/`);
        await page.waitForSelector(".app-shell");
        const api = await page.evaluate(async () => {
          const r = await fetch("/api/command-palette/search?q=BrowserBudget", { headers: { "x-ah": "1" } });
          return r.json();
        });
        const results = (api as { results: Array<{ type: string; title: string }> }).results;
        assert.ok(!results.some((r) => r.type === "budget-tx"));
        await openPalette(page);
        await page.fill("#command-palette-input", "Budget");
        await sleep(400);
        const listText = await page.locator("#command-palette-listbox").innerText();
        assert.ok(!listText.includes("Budget"));
      } finally {
        await context.close();
      }
    });
  } finally {
    await app.close();
  }
});

test("command palette browser: mobile drawer stays inert after palette close via Ctrl+K", { timeout: 120_000 }, async () => {
  const app = await openPaletteServer();
  try {
    await withPage(app, async (page) => {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.goto(`${app.base}/`);
      await page.waitForSelector("#sidebar-toggle");
      await page.locator("#sidebar-toggle").click();
      await page.waitForFunction(
        () => document.querySelector(".app-shell")?.getAttribute("data-mobile-sidebar") === "open",
      );
      assert.equal(await page.evaluate(() => document.querySelector(".sidebar-inset")?.hasAttribute("inert")), true);
      await openPalette(page);
      await page.keyboard.press("Control+k");
      await page.waitForFunction(() => !document.getElementById("command-palette-overlay")?.classList.contains("open"));
      assert.equal(
        await page.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-mobile-sidebar")),
        "open",
      );
      assert.equal(await page.evaluate(() => document.querySelector(".sidebar-inset")?.hasAttribute("inert")), true);
    });
  } finally {
    await app.close();
  }
});

test("command palette browser: mobile drawer stays inert after palette overlay click close", { timeout: 120_000 }, async () => {
  const app = await openPaletteServer();
  try {
    await withPage(app, async (page) => {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.goto(`${app.base}/`);
      await page.waitForSelector("#sidebar-toggle");
      await page.locator("#sidebar-toggle").click();
      await page.waitForFunction(
        () => document.querySelector(".app-shell")?.getAttribute("data-mobile-sidebar") === "open",
      );
      await openPalette(page);
      await page.locator("#command-palette-overlay").click({ position: { x: 8, y: 8 } });
      await page.waitForFunction(() => !document.getElementById("command-palette-overlay")?.classList.contains("open"));
      assert.equal(
        await page.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-mobile-sidebar")),
        "open",
      );
      assert.equal(await page.evaluate(() => document.querySelector(".sidebar-inset")?.hasAttribute("inert")), true);
    });
  } finally {
    await app.close();
  }
});

test("command palette browser: notes source editor Ctrl+K opens palette and Esc restores focus", { timeout: 120_000 }, async () => {
  const app = await openPaletteServer();
  try {
    await withPage(app, async (page) => {
      await page.goto(`${app.base}/notes`);
      await page.waitForSelector('[data-note-mode="source"]');
      await useNotesSourceEditor(page);
      await page.locator("#knowledge-body").focus();
      await page.keyboard.press("Control+k");
      await page.waitForSelector("#command-palette-overlay.open");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("command-palette-overlay")?.classList.contains("open"));
      await page.waitForFunction(() => document.activeElement?.id === "knowledge-body");
    });
  } finally {
    await app.close();
  }
});

test("command palette browser: notes rich editor Ctrl+K opens palette and Esc restores focus", { timeout: 120_000 }, async () => {
  const app = await openPaletteServer();
  try {
    await withPage(app, async (page) => {
      await page.goto(`${app.base}/notes`);
      await page.waitForSelector('[data-note-mode="write"]');
      await focusNotesRichEditor(page);
      await page.keyboard.press("Control+k");
      await page.waitForSelector("#command-palette-overlay.open");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("command-palette-overlay")?.classList.contains("open"));
      await page.waitForFunction(() => {
        const active = document.activeElement;
        return active instanceof HTMLElement && !!active.closest("#knowledge-editor") && active.isContentEditable;
      });
    });
  } finally {
    await app.close();
  }
});

test("command palette browser: source editor Ctrl+B does not toggle sidebar", { timeout: 120_000 }, async () => {
  const app = await openPaletteServer();
  try {
    await withPage(app, async (page) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${app.base}/notes`);
      await page.waitForSelector('[data-note-mode="source"]');
      await useNotesSourceEditor(page);
      await page.locator("#knowledge-body").focus();
      const before = await page.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-sidebar-state"));
      await page.keyboard.press("Control+b");
      await sleep(200);
      const after = await page.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-sidebar-state"));
      assert.equal(after, before);
      assert.equal(await page.locator("#knowledge-body").evaluate((el) => document.activeElement === el), true);
    });
  } finally {
    await app.close();
  }
});

test("command palette browser: notes switcher open blocks Cmd+K palette", { timeout: 120_000 }, async () => {
  const app = await openPaletteServer();
  try {
    await withPage(app, async (page) => {
      await page.goto(`${app.base}/notes`);
      await page.waitForSelector("#knowledge-switch");
      await page.locator("#knowledge-switch").click();
      await page.waitForSelector("#knowledge-switcher[open]");
      await page.keyboard.press("Control+k");
      await sleep(300);
      assert.equal(await page.evaluate(() => document.getElementById("command-palette-overlay")?.classList.contains("open")), false);
      await page.keyboard.press("Control+k");
      await sleep(300);
      assert.equal(await page.evaluate(() => document.getElementById("command-palette-overlay")?.classList.contains("open")), false);
    });
  } finally {
    await app.close();
  }
});

test("command palette browser: notes switcher blocks Cmd+K when focus is on switcher button", { timeout: 120_000 }, async () => {
  const app = await openPaletteServer();
  try {
    await withPage(app, async (page) => {
      await page.goto(`${app.base}/notes`);
      await page.waitForSelector("#knowledge-switch");
      await page.locator("#knowledge-switch").click();
      await page.waitForSelector("#knowledge-switcher[open]");
      await page.locator("#knowledge-switch-close").focus();
      await page.keyboard.press("Control+k");
      await sleep(300);
      assert.equal(await page.evaluate(() => document.getElementById("command-palette-overlay")?.classList.contains("open")), false);
    });
  } finally {
    await app.close();
  }
});

test("command palette browser: notes plain input ignores Cmd+K", { timeout: 120_000 }, async () => {
  const app = await openPaletteServer();
  try {
    await withPage(app, async (page) => {
      await page.goto(`${app.base}/notes`);
      await page.waitForSelector("#knowledge-title");
      await page.locator("#knowledge-title").click();
      await page.waitForFunction(() => document.activeElement?.id === "knowledge-title");
      await page.keyboard.press("Control+k");
      await sleep(300);
      assert.equal(await page.evaluate(() => document.getElementById("command-palette-overlay")?.classList.contains("open")), false);
    });
  } finally {
    await app.close();
  }
});
