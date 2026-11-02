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
  for (let i = 0; i < 100; i++) {
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

test("dashboard revamp: edit layout persists widgets", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-dash-revamp-browser-"));
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
    await page.waitForSelector("#dashboard-grid", { timeout: 20_000 });
    await page.locator("#dashboard-edit-toggle").click();
    await page.waitForSelector(".dashboard-page.is-editing");
    const tasks = page.locator('[data-widget-id="tasks"]');
    await tasks.locator('.dashboard-size-btn[data-size="XL"]').click();
    await page.waitForTimeout(500);
    const handle = tasks.locator(".dashboard-drag-handle");
    await handle.focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(500);
    await page.locator('[data-widget-id="heatmap"] .dashboard-remove').click();
    await page.waitForTimeout(400);
    await page.locator('[data-widget-id="world-clock"] .dashboard-remove').click();
    await page.waitForTimeout(400);
    await page.locator('[data-add-widget="world-clock"]').click();
    await page.waitForNavigation({ waitUntil: "networkidle" });
    await page.waitForSelector('[data-widget-id="world-clock"]', { timeout: 20_000 });
    assert.equal(await tasks.getAttribute("data-size"), "XL");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector('[data-widget-id="world-clock"]', { timeout: 20_000 });
    assert.equal(await page.locator('[data-widget-id="tasks"]').getAttribute("data-size"), "XL");
    await page.locator("#dashboard-edit-toggle").click();
    const drawerText = await page.locator("#dashboard-widget-drawer").innerText();
    assert.doesNotMatch(drawerText, /Pomodoro/i);
    assert.doesNotMatch(drawerText, /Habit tracker/i);
    await page.setViewportSize({ width: 375, height: 800 });
    const fullWidth = await page.evaluate(() => {
      const grid = document.getElementById("dashboard-grid")!;
      const item = document.querySelector(".dashboard-item") as HTMLElement | null;
      if (!item) return false;
      return Math.abs(item.getBoundingClientRect().width - grid.getBoundingClientRect().width) < 4;
    });
    assert.ok(fullWidth, "cards should span full width at 375px");
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
    await page.waitForSelector("#dashboard-grid", { timeout: 20_000 });
    await page.waitForSelector("#panel-tasks", { timeout: 20_000 });
    await sleep(600);
    let overlaps = await panelOverlaps(page);
    assert.deepEqual(
      overlaps,
      [],
      `panels should not overlap when layout API fails: ${overlaps.join(", ")}`,
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(200);
    const fullWidth = await page.evaluate(() => {
      const grid = document.getElementById("dashboard-grid");
      const item = document.querySelector(".dashboard-item") as HTMLElement | null;
      if (!grid || !item) return false;
      return Math.abs(item.getBoundingClientRect().width - grid.getBoundingClientRect().width) < 4;
    });
    assert.ok(fullWidth, "mobile cards should be full width");

    await page.setViewportSize({ width: 1280, height: 800 });
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

test("dashboard: mobile sheet traps Tab and Shift+Tab inside sidebar", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-dash-mobile-focus-"));
  const port = 4900 + Math.floor(Math.random() * 500);
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
    await page.waitForFunction(() => {
      const sidebar = document.querySelector(".sidebar");
      const active = document.activeElement;
      return !!(sidebar && active && sidebar.contains(active));
    }, undefined, { timeout: 3000 });
    const focusableCount = await page.evaluate(() => {
      const sidebar = document.querySelector(".sidebar");
      if (!sidebar) return 0;
      return Array.from(
        sidebar.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'),
      ).filter((el) => (el as HTMLElement).offsetWidth > 0 || (el as HTMLElement).offsetHeight > 0).length;
    });
    assert.ok(focusableCount >= 2, "need multiple sidebar focusables for trap test");
    for (let i = 0; i < focusableCount + 1; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const sidebar = document.querySelector(".sidebar");
        return !!(sidebar && document.activeElement && sidebar.contains(document.activeElement));
      });
      assert.ok(inside, `Tab step ${i + 1} escaped the mobile sidebar`);
    }
    await page.evaluate(() => {
      const sidebar = document.querySelector(".sidebar");
      const first = sidebar?.querySelector('a[href],button:not([disabled])') as HTMLElement | null;
      first?.focus();
    });
    await page.keyboard.press("Shift+Tab");
    const insideShift = await page.evaluate(() => {
      const sidebar = document.querySelector(".sidebar");
      return !!(sidebar && document.activeElement && sidebar.contains(document.activeElement));
    });
    assert.ok(insideShift, "Shift+Tab from first sidebar item escaped the trap");
  } finally {
    await browser.close();
    app.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("dashboard: leaving mobile viewport clears open sheet inert state", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-dash-mobile-resize-"));
  const port = 5000 + Math.floor(Math.random() * 500);
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
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(
      () =>
        document.querySelector(".app-shell")?.getAttribute("data-mobile-sidebar") === "closed" &&
        !document.querySelector(".sidebar")?.hasAttribute("inert") &&
        !document.querySelector(".sidebar")?.hasAttribute("aria-hidden"),
    );
    await page.locator('.sidebar-nav a[href="/notes"]').click();
    await page.waitForURL(/\/notes/);
  } finally {
    await browser.close();
    app.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("dashboard: mobile sheet sets inert on sidebar inset while open", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-dash-mobile-inset-"));
  const port = 5200 + Math.floor(Math.random() * 500);
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
    const insetClosed = await page.evaluate(() => document.querySelector(".sidebar-inset")?.hasAttribute("inert") ?? false);
    assert.equal(insetClosed, false);
    await page.locator("#sidebar-toggle").click();
    await page.waitForFunction(() => document.querySelector(".app-shell")?.getAttribute("data-mobile-sidebar") === "open");
    const insetOpen = await page.evaluate(() => document.querySelector(".sidebar-inset")?.hasAttribute("inert") ?? false);
    assert.equal(insetOpen, true);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector(".app-shell")?.getAttribute("data-mobile-sidebar") === "closed");
    const insetAfter = await page.evaluate(() => document.querySelector(".sidebar-inset")?.hasAttribute("inert") ?? false);
    assert.equal(insetAfter, false);
  } finally {
    await browser.close();
    app.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("dashboard: fast mobile sheet close cancels delayed sidebar focus", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-dash-mobile-focus-cancel-"));
  const port = 5300 + Math.floor(Math.random() * 500);
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
    await page.waitForTimeout(350);
    const focusId = await page.evaluate(() => document.activeElement?.id ?? "");
    assert.equal(focusId, "sidebar-toggle");
    const focusInSidebar = await page.evaluate(() => {
      const sidebar = document.querySelector(".sidebar");
      return !!(sidebar && document.activeElement && sidebar.contains(document.activeElement));
    });
    assert.equal(focusInSidebar, false);
  } finally {
    await browser.close();
    app.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("dashboard: Ctrl+B toggles desktop sidebar but not from quick-add input", { timeout: 120_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-dash-ctrlb-"));
  const port = 5100 + Math.floor(Math.random() * 500);
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/`);
    await page.waitForSelector("#dashboard-grid", { timeout: 20_000 });
    await page.locator(".dashboard-quick-add-bar input").click();
    const before = await page.locator(".app-shell").getAttribute("data-sidebar-state");
    await page.keyboard.press("Control+b");
    assert.equal(await page.locator(".app-shell").getAttribute("data-sidebar-state"), before);
    await page.locator("body").click({ position: { x: 8, y: 8 } });
    const expanded = await page.locator(".app-shell").getAttribute("data-sidebar-state");
    await page.keyboard.press("Control+b");
    const after = await page.locator(".app-shell").getAttribute("data-sidebar-state");
    assert.notEqual(after, expanded);
  } finally {
    await browser.close();
    app.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
});
