import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { BlockedUrlError } from "../src/ssrf";
import { dashboardLayoutUserKey } from "../src/dashboard-layout/user-key";
import { DashboardLayoutStore } from "../src/dashboard-layout/storage";
import { packAfterMove, rectanglesOverlap } from "../src/dashboard-layout/pack";
import { CURRENT_REGISTRY_EPOCH } from "../src/dashboard-layout/widgets";
import { fetchEnvConfiguredUrl } from "../src/service-status/env-fetch";
import {
  getServiceStatusSnapshot,
  resetServiceStatusCacheForTests,
  serviceStatusJson,
} from "../src/service-status/checks";
import { loadConfig } from "../src/config";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

test("env-fetch: blocks redirect to off-origin host", async () => {
  let evil: Server | undefined;
  let proxy: Server | undefined;
  await new Promise<void>((resolve) => {
    evil = createServer((_req, res) => {
      res.writeHead(200);
      res.end("evil");
    });
    evil.listen(0, "127.0.0.1", () => {
      const evilPort = (evil!.address() as AddressInfo).port;
      proxy = createServer((_req, res) => {
        res.writeHead(302, { location: `http://127.0.0.1:${evilPort}/stolen` });
        res.end();
      });
      proxy.listen(0, "127.0.0.1", resolve);
    });
  });
  const proxyPort = (proxy!.address() as AddressInfo).port;
  try {
    await assert.rejects(
      () => fetchEnvConfiguredUrl(`http://127.0.0.1:${proxyPort}`, "/start", { timeoutMs: 2000 }),
      (err: unknown) => err instanceof BlockedUrlError && /off origin/i.test(String(err.message)),
    );
  } finally {
    proxy!.close();
    evil!.close();
  }
});

test("service-status: concurrent snapshots share one upstream HA fetch", async () => {
  resetServiceStatusCacheForTests();
  let calls = 0;
  const ha = createServer((_req, res) => {
    calls += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((r) => ha.listen(0, "127.0.0.1", r));
  const port = (ha.address() as AddressInfo).port;
  const cfg = loadConfig({
    DATA_DIR: "/tmp/unused",
    HA_URL: `http://127.0.0.1:${port}`,
    HA_TOKEN: "token-for-ha-check-only",
  });
  try {
    await Promise.all(Array.from({ length: 8 }, () => getServiceStatusSnapshot(cfg)));
    assert.equal(calls, 1, "in-flight cache should collapse parallel HA probes");
  } finally {
    ha.close();
    resetServiceStatusCacheForTests();
  }
});

test("service-status: serviceStatusJson redacts planted secret in service error string", async () => {
  resetServiceStatusCacheForTests();
  const secret = "PLANTED_serviceStatusJson_err_secret99";
  const cfg = loadConfig({ DATA_DIR: "/tmp/x", HA_TOKEN: secret });
  const json = serviceStatusJson(cfg, [
    {
      id: "home-assistant",
      label: "Home Assistant",
      state: "down",
      downFor: `HTTP 401: authorization Bearer ${secret} rejected`,
    },
  ]);
  assert.doesNotMatch(json, new RegExp(secret));
  assert.match(json, /\[redacted\]/);
});

test("dashboard userKey: hashed, stable, distinct for different users", () => {
  const a = dashboardLayoutUserKey({ who: "alice@example.com", email: "alice@example.com" });
  const b = dashboardLayoutUserKey({ who: "bob@example.com", email: "bob@example.com" });
  assert.match(a, /^u_[a-f0-9]{32}$/);
  assert.equal(a, dashboardLayoutUserKey({ who: "alice@example.com", email: "alice@example.com" }));
  assert.notEqual(a, b);
  assert.doesNotMatch(a, /alice/);
});

test("dashboard layout: packAfterMove pushes overlapping panels down", () => {
  const panels = [
    { id: "activity", x: 0, y: 0, w: 6, h: 4, size: "W" as const },
    { id: "hobie", x: 0, y: 2, w: 3, h: 3, size: "W" as const },
  ];
  const packed = packAfterMove(panels, "activity");
  const a = packed.find((p) => p.id === "activity")!;
  const b = packed.find((p) => p.id === "hobie")!;
  assert.equal(!rectanglesOverlap(a, b), true);
  assert.ok(b.y >= a.y + a.h);
});

test("dashboard layout: at current registry epoch, removed epoch widgets stay removed on load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-epoch-current-"));
  try {
    const cfg = loadConfig({ DATA_DIR: dir, OWNER_EMAILS: "owner@example.com" });
    const principal = { who: "owner@example.com", email: "owner@example.com", owner: true };
    const userKey = dashboardLayoutUserKey(principal);
    const saved = {
      version: 3,
      registryEpoch: CURRENT_REGISTRY_EPOCH,
      widgets: [
        { id: "tasks", size: "W" },
        { id: "today-agenda", size: "XL" },
        { id: "agent-jobs", size: "L" },
        { id: "countdown", size: "S" },
        // epoch-1 widget "world-clock" deliberately removed
      ],
    };
    await mkdir(join(dir, "dashboard-layouts"), { recursive: true });
    await writeFile(join(dir, "dashboard-layouts", `${userKey}.json`), JSON.stringify(saved, null, 2));
    const store = await DashboardLayoutStore.open(dir, cfg);
    const layout = await store.getForUser(principal, false, true);
    assert.ok(layout.widgets.some((w) => w.id === "tasks"));
    assert.ok(!layout.widgets.some((w) => w.id === "world-clock"), "world-clock must stay removed at current epoch");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("service-status API: admin-token is not owner when OWNER_EMAILS is set (prod CF Access)", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { DailyBriefingService } = await import("../src/daily-briefing/service");
  const { makeAuthenticator } = await import("../src/auth");
  const { createApp } = await import("../src/http");
  const { NotesStore } = await import("../src/notes/store");
  const { SettingsStore } = await import("../src/settings");
  const { closeIntegrationServer, openIntegrationStores } = await import("./helpers");

  const TOKEN = "e".repeat(32);
  const dir = await mkdtemp(join(tmpdir(), "cc-svc-admin-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    ALLOW_INSECURE_NO_AUTH: "0",
    OWNER_EMAILS: "owner@example.com",
    CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    CF_ACCESS_AUD: "aud",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg),
    settings,
    dailyBriefing: await DailyBriefingService.open(dir, cfg.tz),
    notes: await NotesStore.open(dir),
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/widgets/service-status`, {
      headers: { authorization: `Bearer ${TOKEN}`, "x-ah": "1" },
    });
    assert.equal(res.status, 403);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("service-status: Plaud HTTP 404 is not up", async () => {
  resetServiceStatusCacheForTests();
  const plaud = createServer((_req, res) => {
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((r) => plaud.listen(0, "127.0.0.1", r));
  const port = (plaud.address() as AddressInfo).port;
  const cfg = loadConfig({ DATA_DIR: "/tmp/x", PLAUD_URL: `http://127.0.0.1:${port}` });
  try {
    const results = await getServiceStatusSnapshot(cfg);
    assert.equal(results.find((r) => r.id === "plaud")?.state, "down");
  } finally {
    plaud.close();
    resetServiceStatusCacheForTests();
  }
});
