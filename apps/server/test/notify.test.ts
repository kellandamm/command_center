import { afterEach, test } from "node:test";
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
import {
  notify,
  resolveNtfyConfig,
  setNtfyTransportForTests,
  shouldSendDuringQuietHours,
} from "../src/notify/ntfy";
import { inQuietHours, parseQuietHours } from "../src/notify/quiet-hours";
import { sendBriefingDigest, runCalendarReminders, retryPendingDigest, runNtfyTick } from "../src/notify/tick";
import { NtfyBackgroundRunner } from "../src/notify/scheduler-ntfy";
import type { DailyBriefingRecord } from "../src/daily-briefing/types";
import { CalendarWorkspace } from "../src/calendar/workspace";

const TOKEN = "t".repeat(32);

function stubTransport(onCall: (url: string, body: string) => void) {
  setNtfyTransportForTests(async (url, opts) => {
    onCall(url, opts.body);
    return { status: 200 };
  });
}

afterEach(() => setNtfyTransportForTests(null));

test("ntfy: no topic is a no-op", async () => {
  const cfg = loadConfig({ ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "1" });
  const resolved = resolveNtfyConfig(cfg, cfg);
  assert.equal(resolved.enabled, false);
  let calls = 0;
  stubTransport(() => { calls++; });
  assert.equal(await notify(resolved, { title: "t", body: "b" }), false);
  assert.equal(calls, 0);
});

test("ntfy: JSON publish with emoji title (no Latin-1 headers)", async () => {
  const cfg = loadConfig({
    ADMIN_TOKEN: TOKEN,
    NTFY_TOPIC: "secret-topic-xyz",
    NTFY_TOKEN: "bearer-secret",
    NTFY_URL: "https://ntfy.sh",
  });
  const resolved = resolveNtfyConfig(cfg, cfg);
  let body = "";
  stubTransport((_url, raw) => { body = raw; });
  assert.equal(await notify(resolved, {
    title: "Lunch 🍕",
    body: "World",
    priority: "default",
    tags: ["a"],
    click: "https://app.example/briefing",
  }), true);
  const parsed = JSON.parse(body) as { title: string; message: string; topic: string; priority: number; click: string };
  assert.equal(parsed.title, "Lunch 🍕");
  assert.equal(parsed.message, "World");
  assert.equal(parsed.topic, "secret-topic-xyz");
  assert.equal(parsed.priority, 3);
  assert.equal(parsed.click, "https://app.example/briefing");
});

test("ntfy: swallows transport errors", async () => {
  const cfg = loadConfig({ ADMIN_TOKEN: TOKEN, NTFY_TOPIC: "t", NTFY_URL: "https://ntfy.sh" });
  setNtfyTransportForTests(async () => { throw new Error("network down"); });
  assert.equal(await notify(resolveNtfyConfig(cfg, cfg), { title: "t", body: "b" }), false);
});

test("ntfy: env topic wins over vault topic", () => {
  const deployment = loadConfig({ ADMIN_TOKEN: TOKEN, NTFY_TOPIC: "from-env" });
  const vault = loadConfig({ ADMIN_TOKEN: TOKEN, NTFY_TOPIC: "from-vault" });
  assert.equal(resolveNtfyConfig(deployment, vault).topic, "from-env");
});

test("quiet hours: America/Chicago regardless of server TZ", () => {
  const window = parseQuietHours("22-7")!;
  const cfg = loadConfig({ ADMIN_TOKEN: TOKEN, NTFY_TOPIC: "t", NTFY_QUIET_HOURS: "22-7", TZ: "UTC" });
  const resolved = resolveNtfyConfig(cfg, cfg);
  const eveningChicago = new Date("2026-10-26T02:30:00.000Z"); // 21:30 CDT Oct 25
  assert.equal(inQuietHours(eveningChicago, window), false);
  assert.equal(shouldSendDuringQuietHours(resolved, eveningChicago), true);
  const morningQuiet = new Date("2026-11-01T12:30:00.000Z"); // 06:30 CST Nov 1
  assert.equal(inQuietHours(morningQuiet, window), true);
  assert.equal(shouldSendDuringQuietHours(resolved, morningQuiet), false);
});

test("briefing digest ignores quiet hours", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-ntfy-quiet-digest-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    NTFY_TOPIC: "brief",
    NTFY_QUIET_HOURS: "22-7",
    TZ: "UTC",
  });
  const sent = await NtfySentSet.open(dir);
  const rec: DailyBriefingRecord = {
    day: "2026-11-01",
    generatedAt: "2026-11-01T12:30:00.000Z",
    trigger: "schedule",
    sources: {
      weather: { status: "not_configured" },
      calendar: { status: "empty", data: { events: [] } },
      topics: { status: "not_configured" },
    },
  };
  let posts = 0;
  stubTransport(() => { posts++; });
  try {
    await sendBriefingDigest({
      deployment: cfg,
      effective: cfg,
      sent,
      now: new Date("2026-11-01T12:30:00.000Z"),
    }, rec, "2026-11-01 06:00");
    assert.equal(posts, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reminder catches up within lead window after a missed tick", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-ntfy-catch-"));
  const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures/demo-week.ics");
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    TZ: "UTC",
    NTFY_TOPIC: "reminders",
    NTFY_REMINDER_MINUTES: "10",
    ICS_LOCAL_FILES: fixture,
  });
  const sent = await NtfySentSet.open(dir);
  const calendar = await CalendarWorkspace.open(cfg);
  let posts = 0;
  stubTransport(() => { posts++; });
  try {
    const deps = {
      deployment: cfg,
      effective: cfg,
      calendar,
      sent,
      now: new Date("2026-10-15T13:55:00.000Z"),
    };
    await runCalendarReminders(deps, { remaining: 10 });
    assert.equal(posts, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reminder dedupe across ticks at ~10 minutes before start", async () => {
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
  let posts = 0;
  stubTransport(() => { posts++; });
  try {
    const start = new Date("2026-10-15T13:50:00.000Z");
    const deps = { deployment: cfg, effective: cfg, calendar, sent, now: start };
    await runCalendarReminders(deps, { remaining: 10 });
    await runCalendarReminders({ ...deps, now: new Date(start.getTime() + 60_000) }, { remaining: 10 });
    assert.equal(posts, 1);
    const reopened = await NtfySentSet.open(dir);
    await runCalendarReminders({ ...deps, sent: reopened, now: new Date(start.getTime() + 120_000) }, { remaining: 10 });
    assert.equal(posts, 1);
  } finally {
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
  const bodies: string[] = [];
  stubTransport((_url, body) => { bodies.push(body); });
  try {
    const deps = { deployment: cfg, effective: cfg, sent, now: new Date(rec.generatedAt) };
    await sendBriefingDigest(deps, rec, "2026-10-13 06:00");
    await sendBriefingDigest(deps, rec, "2026-10-13 06:00");
    assert.equal(bodies.length, 1);
    const parsed = JSON.parse(bodies[0]!) as { click?: string };
    assert.equal(parsed.click, "https://home.example/briefing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pending digest retries after failed send", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-ntfy-pending-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, NTFY_TOPIC: "brief" });
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
  let calls = 0;
  setNtfyTransportForTests(async () => {
    calls++;
    return { status: calls === 1 ? 500 : 200 };
  });
  const deps = { deployment: cfg, effective: cfg, sent, now: new Date(rec.generatedAt) };
  try {
    await sendBriefingDigest(deps, rec, "2026-10-13 06:00");
    assert.ok(sent.pendingDigest());
    assert.equal(calls, 1);
    await retryPendingDigest(deps, { remaining: 10 });
    assert.equal(calls, 2);
    assert.ok(sent.has("digest:2026-10-13 06:00"));
    assert.equal(sent.pendingDigest(), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("background runner queues digest while a tick is in flight", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-ntfy-queue-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, NTFY_TOPIC: "q" });
  const sent = await NtfySentSet.open(dir);
  const settings = new SettingsStore(dir);
  await settings.load();
  let inFlight = 0;
  let maxInFlight = 0;
  let posts = 0;
  setNtfyTransportForTests(async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    posts++;
    await new Promise((r) => setTimeout(r, 40));
    inFlight--;
    return { status: 200 };
  });
  const runner = new NtfyBackgroundRunner();
  const hooks = {
    deployment: cfg,
    cfg,
    ntfySent: sent,
  };
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
  try {
    const now = new Date(rec.generatedAt);
    runner.scheduleBriefingDigest(hooks, rec, "2026-10-13 06:00", now);
    runner.scheduleBriefingDigest(hooks, rec, "2026-10-14 06:00", now);
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(maxInFlight, 1);
    assert.equal(posts, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function notifyApiHarness(owner: boolean, extra: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cc-ntfy-api-"));
  const deployment = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    ALLOW_INSECURE_NO_AUTH: "1",
    NTFY_TOPIC: "phone",
    ...extra,
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
  stubTransport(() => {});
  const h = await notifyApiHarness(true);
  try {
    const ok = await fetch(`${h.base}/api/notify/test`, { method: "POST", headers: { "x-ah": "1" } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
  } finally {
    await h.close();
  }
});

test("notify test endpoint bypasses quiet hours", async () => {
  stubTransport(() => {});
  const h = await notifyApiHarness(true, { NTFY_QUIET_HOURS: "22-7", TZ: "UTC" });
  try {
    const ok = await fetch(`${h.base}/api/notify/test`, { method: "POST", headers: { "x-ah": "1" } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
  } finally {
    await h.close();
  }
});

test("scheduler sends digest after successful briefing generation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-ntfy-sched-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, TZ: "UTC", NTFY_TOPIC: "sched" });
  const settings = new SettingsStore(dir);
  await settings.load();
  await settings.update({ briefingTime: "06:00", briefingTopics: [] });
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
  stubTransport(() => { posts++; });
  const memory = new Map<string, unknown>();
  const kv: KVLike = {
    get: async <T>(key: string) => memory.get(key) as T | undefined,
    set: async (key, value) => { memory.set(key, value); },
  };
  try {
    const daily = { generate: async () => record } as unknown as DailyBriefingService;
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
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(posts, 1);
    await scheduler.tick();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(posts, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("env NTFY_URL may target private docker origin", async () => {
  const cfg = loadConfig({ ADMIN_TOKEN: TOKEN, NTFY_TOPIC: "dock", NTFY_URL: "http://ntfy:80" });
  const resolved = resolveNtfyConfig(cfg, cfg);
  assert.equal(resolved.envOrigin, "http://ntfy");
  let seenOrigin: string | null = "unset";
  setNtfyTransportForTests(async (_url, opts) => {
    seenOrigin = opts.envOrigin;
    return { status: 200 };
  });
  await notify(resolved, { title: "t", body: "b" });
  assert.equal(seenOrigin, "http://ntfy");
});
