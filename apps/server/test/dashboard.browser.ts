import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

function startServer(dataDir: string, port: number): ChildProcess {
  return spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: join(import.meta.dirname, ".."),
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      HOST: "127.0.0.1",
      PORT: String(port),
      ALLOW_INSECURE_NO_AUTH: "1",
      TZ: "UTC",
      OWNER_EMAILS: "owner@example.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("dashboard v1 panels load in browser", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-dash-browser-"));
  const port = 4100 + Math.floor(Math.random() * 500);
  const base = `http://127.0.0.1:${port}`;
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("pnpm", ["exec", "tsx", "scripts/seed-dashboard-screenshot.ts"], {
      cwd: join(import.meta.dirname, ".."),
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
    seed.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed ${code}`))));
  });
  const app = startServer(dataDir, port);
  const browser = await chromium.launch();
  try {
    await waitForServer(base);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/`);
    await page.waitForSelector("#panel-tasks #tasks-list li", { timeout: 20_000 });
    await page.waitForSelector("#panel-attention .attention-reason", { timeout: 20_000 });
    await page.waitForSelector("#panel-heatmap .heatmap-cell.level-1, #panel-heatmap .heatmap-cell.level-2", { timeout: 20_000 });
    await page.waitForSelector("#panel-launchpad .launchpad-tile", { timeout: 20_000 });
    assert.ok(await page.locator(".attention-block h3", { hasText: "Continue working" }).count());
    assert.ok(await page.locator(".attention-block h3", { hasText: "On this day" }).count());
    assert.ok(await page.locator(".attention-block h3", { hasText: "Rediscover" }).count());
    const overlaps = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("#dashboard-grid .dashboard-item"));
      const boxes = items.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.getAttribute("data-panel-id") ?? "",
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
        };
      });
      const hits: string[] = [];
      const gap = 0.5;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const overlap =
            a.left < b.right - gap &&
            a.right > b.left + gap &&
            a.top < b.bottom - gap &&
            a.bottom > b.top + gap;
          if (overlap) hits.push(`${a.id}×${b.id}`);
        }
      }
      return hits;
    });
    assert.deepEqual(overlaps, [], `dashboard panels overlap: ${overlaps.join(", ")}`);
    const collapsedGaps = await page.evaluate(() => {
      const grid = document.getElementById("dashboard-grid");
      const gap = parseFloat(getComputedStyle(grid!).rowGap || "6") || 6;
      const strip = parseFloat(grid?.style.getPropertyValue("--dash-strip-h") || "30") || 30;
      const issues: string[] = [];
      document.querySelectorAll("#dashboard-grid .dashboard-item.is-collapsed").forEach((el) => {
        const id = el.getAttribute("data-panel-id") || "";
        const r = el.getBoundingClientRect();
        const below = Array.from(document.querySelectorAll("#dashboard-grid .dashboard-item")).filter((other) => {
          if (other === el) return false;
          const o = other.getBoundingClientRect();
          const sameColumn = o.left < r.right - 2 && o.right > r.left + 2;
          return sameColumn && o.top >= r.bottom - 1;
        });
        if (!below.length) return;
        const nextTop = Math.min(...below.map((n) => n.getBoundingClientRect().top));
        const slack = nextTop - r.bottom;
        if (slack > gap + 2) issues.push(`${id}:${Math.round(slack)}px`);
      });
      return { issues, gap, strip };
    });
    assert.deepEqual(
      collapsedGaps.issues,
      [],
      `collapsed panels have extra vertical slack (gap≈${collapsedGaps.gap}px): ${collapsedGaps.issues.join(", ")}`,
    );
    assert.match(await page.locator("h1").first().textContent() ?? "", /Dashboard/i);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator("#dashboard-grid .dashboard-item").count() >= 4);
  } finally {
    await browser.close();
    app.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function panelOverlaps(page: import("playwright").Page): Promise<string[]> {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("#dashboard-grid .dashboard-item"));
    const boxes = items.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute("data-panel-id") ?? "",
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      };
    });
    const hits: string[] = [];
    const gap = 0.5;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap =
          a.left < b.right - gap &&
          a.right > b.left + gap &&
          a.top < b.bottom - gap &&
          a.bottom > b.top + gap;
        if (overlap) hits.push(`${a.id}×${b.id}`);
      }
    }
    return hits;
  });
}

test("dashboard packed desktop: drag, keyboard, resize, and viewport reflow", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-dash-packed-edit-"));
  const port = 4600 + Math.floor(Math.random() * 500);
  const base = `http://127.0.0.1:${port}`;
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("pnpm", ["exec", "tsx", "scripts/seed-dashboard-screenshot.ts"], {
      cwd: join(import.meta.dirname, ".."),
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
    seed.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed ${code}`))));
  });
  const app = startServer(dataDir, port);
  const browser = await chromium.launch();
  try {
    await waitForServer(base);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/`);
    await page.waitForSelector("#dashboard-grid.is-packed", { timeout: 20_000 });
    await page.waitForSelector("#panel-tasks", { timeout: 20_000 });

    const tasksHandle = page.locator('[data-panel-id="tasks"] .dashboard-drag-handle');
    const tasksY0 = Number(await page.locator('[data-panel-id="tasks"]').getAttribute("data-logical-y"));
    const tBox = await tasksHandle.boundingBox();
    assert.ok(tBox);
    await page.mouse.move(tBox.x + tBox.width / 2, tBox.y + tBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(tBox.x + tBox.width / 2, tBox.y + 220, { steps: 15 });
    await page.mouse.up();
    await page.waitForFunction(
      (start) => Number(document.querySelector('[data-panel-id="tasks"]')?.getAttribute("data-logical-y")) > start,
      tasksY0,
      { timeout: 3000 },
    );
    const tasksYDrag = Number(await page.locator('[data-panel-id="tasks"]').getAttribute("data-logical-y"));
    assert.ok(tasksYDrag > tasksY0, `drag should increase logical y (${tasksY0} -> ${tasksYDrag})`);

    await tasksHandle.focus();
    const tasksYKey0 = Number(await page.locator('[data-panel-id="tasks"]').getAttribute("data-logical-y"));
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(
      (start) => Number(document.querySelector('[data-panel-id="tasks"]')?.getAttribute("data-logical-y")) > start,
      tasksYKey0,
      { timeout: 3000 },
    );
    const tasksY1 = Number(await page.locator('[data-panel-id="tasks"]').getAttribute("data-logical-y"));
    assert.ok(tasksY1 > tasksYKey0, `ArrowDown should increase logical y (${tasksYKey0} -> ${tasksY1})`);

    const tasksH0 = Number(
      await page.locator('[data-panel-id="tasks"]').getAttribute("data-logical-h"),
    );
    const resize = page.locator('[data-panel-id="tasks"] .dashboard-resize');
    const rBox = await resize.boundingBox();
    assert.ok(rBox);
    await page.mouse.move(rBox.x + rBox.width / 2, rBox.y + rBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(rBox.x + rBox.width / 2, rBox.y + 80, { steps: 8 });
    await page.mouse.up();
    await sleep(450);
    const tasksH1 = Number(
      await page.locator('[data-panel-id="tasks"]').getAttribute("data-logical-h"),
    );
    assert.ok(tasksH1 > tasksH0, `resize should increase logical h (${tasksH0} -> ${tasksH1})`);

    await page.setViewportSize({ width: 1100, height: 800 });
    await sleep(300);
    const overlaps = await panelOverlaps(page);
    assert.deepEqual(overlaps, [], `viewport resize should not overlap panels: ${overlaps.join(", ")}`);
  } finally {
    await browser.close();
    app.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("dashboard: bootstrap without layout API and breakpoint reflow", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-dash-bootstrap-"));
  const port = 4700 + Math.floor(Math.random() * 500);
  const base = `http://127.0.0.1:${port}`;
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("pnpm", ["exec", "tsx", "scripts/seed-dashboard-screenshot.ts"], {
      cwd: join(import.meta.dirname, ".."),
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
    seed.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed ${code}`))));
  });
  const app = startServer(dataDir, port);
  const browser = await chromium.launch();
  try {
    await waitForServer(base);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route("**/api/dashboard-layout", (route) => route.abort());
    await page.goto(`${base}/`);
    await page.waitForSelector("#dashboard-grid.is-packed", { timeout: 20_000 });
    await page.waitForSelector("#panel-tasks", { timeout: 20_000 });
    await sleep(600);
    let overlaps = await panelOverlaps(page);
    assert.deepEqual(
      overlaps,
      [],
      `panels should not overlap when layout API fails: ${overlaps.join(", ")}`,
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForSelector("#dashboard-grid.is-stacked", { timeout: 10_000 });
    await sleep(200);
    const stackedInline = await page.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll("#dashboard-grid .dashboard-item").forEach((el) => {
        const id = el.getAttribute("data-panel-id") || "";
        const style = (el as HTMLElement).style;
        ["left", "top", "width", "height"].forEach((prop) => {
          const v = style[prop as "left"];
          if (v && v.endsWith("px")) bad.push(`${id}:${prop}=${v}`);
        });
      });
      return bad;
    });
    assert.deepEqual(stackedInline, [], `stacked mode should clear packed inline px: ${stackedInline.join(", ")}`);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForSelector("#dashboard-grid.is-packed", { timeout: 10_000 });
    await sleep(200);
    overlaps = await panelOverlaps(page);
    assert.deepEqual(overlaps, [], `packed mode after reflow should not overlap: ${overlaps.join(", ")}`);
  } finally {
    await browser.close();
    app.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("dashboard: Esc closes mobile sidebar and layout menu; Ctrl+B ignored in textarea", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-dash-a11y-"));
  const port = 4800 + Math.floor(Math.random() * 500);
  const base = `http://127.0.0.1:${port}`;
  await new Promise<void>((resolve, reject) => {
    const seed = spawn("pnpm", ["exec", "tsx", "scripts/seed-dashboard-screenshot.ts"], {
      cwd: join(import.meta.dirname, ".."),
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
    seed.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed ${code}`))));
  });
  const app = startServer(dataDir, port);
  const browser = await chromium.launch();
  try {
    await waitForServer(base);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${base}/`);
    await page.waitForSelector("#dashboard-grid", { timeout: 20_000 });
    await page.locator("#sidebar-toggle").click();
    await page.waitForFunction(() => document.querySelector(".app-shell")?.getAttribute("data-mobile-sidebar") === "open");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector(".app-shell")?.getAttribute("data-mobile-sidebar") === "closed");
    const focusAfterEsc = await page.evaluate(() => document.activeElement?.id ?? "");
    assert.equal(focusAfterEsc, "sidebar-toggle");

    await page.locator(".dashboard-quick-add-bar input").click({ position: { x: 4, y: 4 } });
    const expandedBefore = await page.locator(".app-shell").getAttribute("data-sidebar-state");
    await page.keyboard.press("Control+b");
    const expandedAfter = await page.locator(".app-shell").getAttribute("data-sidebar-state");
    assert.equal(expandedAfter, expandedBefore);

    await page.locator(".page-header-menu summary").click();
    await page.waitForSelector(".page-header-menu[open]");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".page-header-menu[open]"));
    const menuFocus = await page.evaluate(() => document.activeElement?.matches(".page-header-menu summary") ?? false);
    assert.ok(menuFocus);
  } finally {
    await browser.close();
    app.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
});
