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
