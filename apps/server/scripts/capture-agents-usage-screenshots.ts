/**
 * Seed sample agents usage data and capture Usage page screenshots.
 * Usage: pnpm exec tsx scripts/capture-agents-usage-screenshots.ts
 */
import { mkdtemp, rm } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const serverDir = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = join(serverDir, "../..");
const IMPORT_TOKEN = "s".repeat(32);
const ADMIN_TOKEN = "a".repeat(32);
const OUT_DIR = join(repoRoot, "docs/screenshots/agents-usage");

async function startServer(dataDir: string, port: string): Promise<{ base: string; stop: () => Promise<void> }> {
  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    PORT: port,
    HOST: "127.0.0.1",
    ALLOW_INSECURE_NO_AUTH: "1",
    ADMIN_TOKEN,
    AGENTS_USAGE_IMPORT_TOKEN: IMPORT_TOKEN,
    TZ: "UTC",
  };
  let proc: ChildProcess | undefined;
  const base = await new Promise<string>((resolve, reject) => {
    proc = spawn("pnpm", ["exec", "tsx", "src/index.ts"], { cwd: serverDir, env, stdio: ["ignore", "pipe", "inherit"] });
    let buf = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const m = buf.match(/listening on 127\.0\.0\.1:(\d+)/);
      if (m) resolve(`http://127.0.0.1:${m[1]}`);
    });
    proc.on("error", reject);
    proc.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  await new Promise((r) => setTimeout(r, 400));
  return {
    base,
    stop: async () => {
      proc?.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
    },
  };
}

async function importPayload(base: string, body: unknown) {
  const res = await fetch(`${base}/api/agents/usage/import`, {
    method: "POST",
    headers: { authorization: `Bearer ${IMPORT_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`import ${res.status}`);
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "cc-usage-shot-"));
  const sampleDir = await mkdtemp(join(tmpdir(), "cc-usage-shot2-"));
  const { base: baseSample, stop: stopSample } = await startServer(sampleDir, "9876");
  const { base: baseUnavail, stop: stopUnavail } = await startServer(dataDir, "9877");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await importPayload(baseSample, {
      asOf: "2026-10-19T08:00:00.000Z",
      weeklyPercentUsed: 18,
      resetsAt: "2026-10-24T09:00:00.000Z",
      byBot: [{ name: "Grok", share: 62 }],
      byRoutine: [{ name: "Coding", share: 70 }],
      byDay: [
        { date: "2026-10-19", share: 10 },
        { date: "2026-10-20", share: 14 },
        { date: "2026-10-21", share: 18 },
      ],
      checkins: [{ bot: "Grok", date: "2026-10-21", note: "Ahead on coding tasks" }],
    });
    await importPayload(baseSample, {
      asOf: "2026-10-21T08:00:00.000Z",
      weeklyPercentUsed: 52,
      resetsAt: "2026-10-24T09:00:00.000Z",
      byBot: [{ name: "Grok", share: 62 }],
      byRoutine: [{ name: "Coding", share: 70 }],
      byDay: [
        { date: "2026-10-19", share: 10 },
        { date: "2026-10-20", share: 14 },
        { date: "2026-10-21", share: 18 },
      ],
      checkins: [{ bot: "Grok", date: "2026-10-21", note: "Ahead on coding tasks" }],
    });
    await page.goto(`${baseSample}/agent?view=usage&token=${encodeURIComponent(ADMIN_TOKEN)}`);
    await page.waitForSelector("#usage-root:not([hidden])", { timeout: 20_000 });
    await page.screenshot({ path: join(OUT_DIR, "sample-1280x800.png"), fullPage: true });

    await importPayload(baseUnavail, {
      asOf: "2026-10-21T09:00:00.000Z",
      weeklyPercentUsed: null,
      resetsAt: "2026-10-24T09:00:00.000Z",
      byBot: [],
      byRoutine: [],
      byDay: [],
    });
    await page.goto(`${baseUnavail}/agent?view=usage&token=${encodeURIComponent(ADMIN_TOKEN)}`);
    await page.getByText("Unavailable").first().waitFor({ timeout: 20_000 });
    await page.screenshot({ path: join(OUT_DIR, "unavailable-1280x800.png"), fullPage: true });
  } finally {
    await browser.close();
    await stopSample();
    await stopUnavail();
    await rm(sampleDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
