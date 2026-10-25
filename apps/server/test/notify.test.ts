import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { SettingsStore } from "../src/settings";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { NotesStore } from "../src/notes/store";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";
import { Scheduler, type KVLike } from "../src/scheduler";
import { NtfySentSet } from "../src/notify/sent-set";
import { notify, resolveNtfyRuntime, shouldSendDuringQuietHours } from "../src/notify/ntfy";
import { inQuietHours, parseQuietHours } from "../src/notify/quiet-hours";
import { sendBriefingDigest, runCalendarReminders } from "../src/notify/tick";
import type { DailyBriefingRecord } from "../src/daily-briefing/types";
import { CalendarWorkspace } from "../src/calendar/workspace";
const TOKEN = "t".repeat(32);

test("ntfy: no topic is a no-op", async () => {
  const cfg = loadConfig({ ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "1" });
  const runtime = resolveNtfyRuntime(cfg, cfg);
  assert.equal(runtime.enabled, false);
  let called = false;
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { called = true; return new Response("ok"); };
  try {
    assert.equal(await notify(runtime, { title: "t", body: "b" }), false);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = orig;
  }
});

test("ntfy: posts with headers and swallows errors", async () => {
  const cfg = loadConfig({
    ADMIN_TOKEN: TOKEN,
    ALLOW_INSECURE_NO_AUTH: "1",
    NTFY_TOPIC: "secret-topic-xyz",
    NTFY_TOKEN: "bearer-secret",
    NTFY_URL: "https://ntfy.sh",
  });
  const runtime = resolveNtfyRuntime(cfg, cfg);
  const calls: { url: string; init?: RequestInit }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response("ok", { status: 200 });
  };
  try {
    assert.equal(await notify(runtime, {
      title: "Hello",
      body: "World",
      priority: "high",
      tags: ["a", "b"],
      click: "https://app.example/briefing",
    }), true);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /ntfy\.sh\/secret-topic-xyz/);
    const headers = new Headers(calls[0]!.init?.headers);
    assert.equal(headers.get("Title"), "Hello");
    assert.equal(headers.get("Priority"), "high");
    assert.equal(headers.get("Tags"), "a,b");
    assert.equal(headers.get("Click"), "https://app.example/briefing");
    assert.equal(headers.get("Authorization"), "Bearer bearer-secret");
  } finally {
    globalThis.fetch = orig;
  }

  globalThis.fetch = async () => { throw new Error("network down"); };
  try {
    assert.equal(await notify(runtime, { title: "t", body: "b" }), false);
  } finally {
    globalThis.fetch = orig;
  }
});

test("ntfy: env topic wins over vault topic", () => {
  const deployment = loadConfig({ ADMIN_TOKEN: TOKEN, NTFY_TOPIC: "from-env" });
  const vault = loadConfig({ ADMIN_TOKEN: TOKEN, NTFY_TOPIC: "from-vault" });
  const runtime = resolveNtfyRuntime(deployment, vault);
  assert.equal(runtime.topic, "from-env");
});

test("quiet hours: parse and block low priority", () => {
  assert.deepEqual(parseQuietHours("22-7"), { startHour: 22, endHour: 7 });
  const tz = "America/Chicago";
  const window = parseQuietHours("22-7")!;
  const late = new Date("2026-01-15T04:00:00Z"); // 22:00 CST
  assert.equal(inQuietHours(late, tz, window), true);
  const cfg = loadConfig({ ADMIN_TOKEN: TOKEN, NTFY_TOPIC: "t", NTFY_QUIET_HOURS: "22-7", TZ: tz });
  const runtime = resolveNtfyRuntime(cfg, cfg);
  assert.equal(shouldSendDuringQuietHours(runtime, "default", late), false);
  assert.equal(shouldSendDuringQuietHours(runtime, "high", late), true);
});

test("reminder dedupe across ticks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-ntfy-"));
  const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures/demo-week.ics");
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    TZ: "UTC",
    NTFY_TOPIC: "reminders",
    ICS_LOCAL_FILES: fixture,
  });
  const sent = await NtfySentSet.open(dir);
  const calendar = await CalendarWorkspace.open(cfg);
  const posts: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (input) => {
    posts.push(String(input));
    return new Response("ok", { status: 200 });
  };
  try {
    const start = new Date("2026-10-15T13:55:00.000Z");
    const deps = {
      deployment: cfg,
      effective: cfg,
      calendar,
      sent,
      now: start,
    };
    await runCalendarReminders(deps);
    await runCalendarReminders({ ...deps, now: new Date(start.getTime() + 60_000) });
    assert.equal(posts.length, 1);
    const reopened = await NtfySentSet.open(dir);
    await runCalendarReminders({ ...deps, sent: reopened, now: new Date(start.getTime() + 120_000) });
    assert.equal(posts.length, 1);
  } finally {
    globalThis.fetch = orig;
    await rm(dir, { recursive: true, force: true });
  }
});

test("briefing digest fires once per slot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-ntfy-digest-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, NTFY_TOPIC: "brief", APP_PUBLIC_URL: "https://home.example" });
  const sent = await NtfySentSet.open(dir);
  const rec: DailyBriefingRecord = {
    day: "2026-10-13",
    generatedAt: "2026-10-13T12:00:00Z",
    trigger: "schedule",
    sources: {
      weather: { status: "not_configured" },
      calendar: { status: "empty", data: { events: [] } },
      topics: { status: "not_configured" },
    },
  };
  const posts: RequestInit[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    posts.push(init ?? {});
    return new Response("ok", { status: 200 });
  };
  try {
    const deps = { deployment: cfg, effective: cfg, sent, now: new Date(rec.generatedAt) };
    await sendBriefingDigest(deps, rec, "2026-10-13 06:00");
    await sendBriefingDigest(deps, rec, "2026-10-13 06:00");
    assert.equal(posts.length, 1);
    const headers = new Headers(posts[0]!.headers);
    assert.equal(headers.get("Click"), "https://home.example/briefing");
  } finally {
    globalThis.fetch = orig;
    await rm(dir, { recursive: true, force: true });
  }
});

async function notifyApiHarness(owner: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "cc-ntfy-api-"));
  const deployment = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    ALLOW_INSECURE_NO_AUTH: "1",
    NTFY_TOPIC: "phone",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, deployment.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, deployment);
  const server = createApp({
    cfg: deployment,
    deployment,
    auth: owner
      ? async () => ({ ok: true, who: "owner@example.com", owner: true })
      : makeAuthenticator(deployment),
    settings,
    dailyBriefing,
    notes,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, close };
}

test("notify test endpoint requires owner", async () => {
  const h = await notifyApiHarness(false);
  try {
    const denied = await fetch(`${h.base}/api/notify/test`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "x-ah": "1" },
    });
    assert.equal(denied.status, 403);
  } finally {
    await h.close();
  }
});

test("notify test endpoint sends for owner", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("ntfy.sh")) return new Response("ok", { status: 200 });
    return origFetch(input, init);
  };
  const h = await notifyApiHarness(true);
  try {
    const ok = await fetch(`${h.base}/api/notify/test`, { method: "POST", headers: { "x-ah": "1" } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
  } finally {
    globalThis.fetch = origFetch;
    await h.close();
  }
});

test("scheduler sends digest after successful briefing generation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-ntfy-sched-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, TZ: "UTC", NTFY_TOPIC: "sched" });
  const settings = new SettingsStore(dir);
  await settings.load();
  await settings.update({ briefingTime: "06:00", briefingTopics: [] });
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const sent = await NtfySentSet.open(dir);
  const record: DailyBriefingRecord = {
    day: "2026-10-13",
    generatedAt: "2026-10-13T11:31:00.000Z",
    trigger: "schedule",
    sources: {
      weather: { status: "empty" },
      calendar: { status: "not_configured", data: { events: [] } },
      topics: { status: "not_configured" },
    },
  };
  let posts = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { posts++; return new Response("ok", { status: 200 }); };
  const memory = new Map<string, unknown>();
  const kv: KVLike = {
    get: async <T>(key: string) => memory.get(key) as T | undefined,
    set: async (key, value) => { memory.set(key, value); },
  };
  try {
    const generate = async () => record;
    const daily = { generate } as unknown as DailyBriefingService;
    const now = new Date("2026-10-13T11:31:00.000Z");
    const scheduler = new Scheduler({
      deployment: cfg,
      cfg,
      settings,
      kv,
      dailyBriefing: daily,
      ntfySent: sent,
      now: () => now,
    });
    await scheduler.tick();
    assert.equal(posts, 1);
    await scheduler.tick();
    assert.equal(posts, 1);
  } finally {
    globalThis.fetch = orig;
    await rm(dir, { recursive: true, force: true });
  }
});
