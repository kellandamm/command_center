import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { defaultDashboardLayout } from "../src/dashboard-layout/defaults";
import { buildDashboardRenderContext } from "../src/dashboard-layout/dashboard-context";
import { normalizeDashboardLayout, parseDashboardLayout } from "../src/dashboard-layout/normalize";
import { packWidgetFlow, overlappingPanelPairs } from "../src/dashboard-layout/pack";
import { DashboardLayoutStore, dashboardLayoutUserKey } from "../src/dashboard-layout/storage";
import { dashboardLayoutV3Schema, MAX_LAYOUT_BYTES } from "../src/dashboard-layout/schema";
import { widgetIdsForSession } from "../src/dashboard-layout/widgets";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";
import { agendaNowMarkerPercent } from "../src/widgets/today-agenda";
import { getServiceStatusSnapshot, resetServiceStatusCacheForTests, serviceStatusJson } from "../src/service-status/checks";

const TOKEN = "d".repeat(32);

function knownIds(showBudget = true, showServiceStatus = true) {
  return widgetIdsForSession({ showBudget, showServiceStatus });
}

test("dashboard revamp layout schema: valid v3", () => {
  const layout = defaultDashboardLayout({ showBudget: true });
  const parsed = dashboardLayoutV3Schema.safeParse({ version: 3, widgets: layout.widgets });
  assert.equal(parsed.success, true);
  assert.deepEqual(overlappingPanelPairs(packWidgetFlow(layout.widgets)), []);
});

test("dashboard revamp layout schema: corrupt and oversize fall back", () => {
  const ids = knownIds(false);
  const corrupt = parseDashboardLayout("{not json", ids, false);
  assert.equal(corrupt.version, 3);
  assert.ok(corrupt.widgets.length > 0);
  const huge = parseDashboardLayout({ version: 3, widgets: Array.from({ length: 50 }, (_, i) => ({ id: "tasks", size: "S" as const })) }, ids, false);
  assert.ok(huge.widgets.length <= 40);
  assert.ok(Buffer.byteLength(JSON.stringify(huge)) < MAX_LAYOUT_BYTES * 2);
});

test("dashboard revamp layout schema: unknown widget dropped on save", () => {
  const ids = knownIds(false);
  const next = normalizeDashboardLayout(
    { version: 3, widgets: [{ id: "unknown-widget", size: "W" }, { id: "tasks", size: "S" }] },
    ids,
    false,
    { appendMissing: false },
  );
  assert.ok(!next.widgets.some((w) => w.id === "unknown-widget"));
  assert.ok(next.widgets.some((w) => w.id === "tasks"));
});

test("dashboard layout API: auth required", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dash-revamp-auth-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "0" });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg),
    settings,
    dailyBriefing,
    notes,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const unauth = await fetch(`${base}/api/dashboard-layout`);
    assert.equal(unauth.status, 401);
    const authz = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-ah": "1" };
    const ok = await fetch(`${base}/api/dashboard-layout`, { headers: authz });
    assert.equal(ok.status, 200);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("dashboard layout store: per-user isolation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dash-revamp-users-"));
  try {
    const store = await DashboardLayoutStore.open(dir);
    await store.updateForUser(
      { who: "a@example.com", email: "a@example.com" },
      { version: 3, widgets: [{ id: "tasks", size: "XL" }] },
      false,
    );
    await store.updateForUser(
      { who: "b@example.com", email: "b@example.com" },
      { version: 3, widgets: [{ id: "tasks", size: "S" }] },
      false,
    );
    const keyA = dashboardLayoutUserKey({ who: "a@example.com", email: "a@example.com" });
    const keyB = dashboardLayoutUserKey({ who: "b@example.com", email: "b@example.com" });
    const fileA = JSON.parse(await readFile(join(dir, "dashboard-layouts", `${keyA}.json`), "utf8"));
    const fileB = JSON.parse(await readFile(join(dir, "dashboard-layouts", `${keyB}.json`), "utf8"));
    assert.equal(fileA.widgets[0].size, "XL");
    assert.equal(fileB.widgets[0].size, "S");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("service-status redaction removes planted secret", async () => {
  resetServiceStatusCacheForTests();
  const secret = "PLANTED_SECRET_abc123xyz";
  const cfg = loadConfig({
    DATA_DIR: "/tmp/unused",
    ADMIN_TOKEN: secret,
    TODOIST_API_TOKEN: secret,
    ALLOW_INSECURE_NO_AUTH: "1",
  });
  await getServiceStatusSnapshot(cfg);
  const json = serviceStatusJson(cfg, await getServiceStatusSnapshot(cfg));
  assert.doesNotMatch(json, new RegExp(secret));
});

test("today-agenda now marker respects workspace TZ", () => {
  const fixed = new Date("2026-11-02T19:00:00.000Z"); // 1:00 PM Chicago
  const chicago = agendaNowMarkerPercent(fixed, "America/Chicago", { startH: 8, endH: 16 });
  assert.ok(Math.abs(chicago - 62.5) < 2, `Chicago marker ${chicago}`);
});

test("dashboard revamp layout schema: rejects bad widget fields via API", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dash-schema-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "1" });
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
  const authz = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-ah": "1" };
  try {
    const bad = await fetch(`${base}/api/dashboard-layout`, {
      method: "PUT",
      headers: authz,
      body: JSON.stringify({ version: 3, widgets: [{ id: "tasks", size: "HUGE" }] }),
    });
    assert.equal(bad.status, 400);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("dashboard layout API: HTTP per-user isolation and budget gating", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dash-http-users-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: "0",
    OWNER_EMAILS: "owner@example.com",
    CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-audience",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const integration = await openIntegrationStores(dir, cfg);
  const auth = makeAuthenticator(cfg, async (token) => {
    if (token === "owner-jwt") return { email: "owner@example.com" };
    if (token === "viewer-jwt") return { email: "viewer@example.com" };
    throw new Error("invalid jwt");
  });
  const server = createApp({
    cfg,
    auth,
    settings,
    dailyBriefing: await DailyBriefingService.open(dir, cfg.tz),
    notes: await NotesStore.open(dir),
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ownerHeaders = {
    "content-type": "application/json",
    "x-ah": "1",
    "cf-access-jwt-assertion": "owner-jwt",
  };
  const viewerHeaders = {
    "content-type": "application/json",
    "x-ah": "1",
    "cf-access-jwt-assertion": "viewer-jwt",
  };
  try {
    await fetch(`${base}/api/dashboard-layout`, {
      method: "PUT",
      headers: ownerHeaders,
      body: JSON.stringify({ version: 3, widgets: [{ id: "tasks", size: "XL" }] }),
    });
    await fetch(`${base}/api/dashboard-layout`, {
      method: "PUT",
      headers: viewerHeaders,
      body: JSON.stringify({ version: 3, widgets: [{ id: "tasks", size: "S" }] }),
    });
    const ownerGet = await fetch(`${base}/api/dashboard-layout`, { headers: ownerHeaders });
    const viewerGet = await fetch(`${base}/api/dashboard-layout`, { headers: viewerHeaders });
    const ownerLayout = (await ownerGet.json()) as { layout: { widgets: { size: string }[] } };
    const viewerLayout = (await viewerGet.json()) as { layout: { widgets: { size: string }[] } };
    assert.equal(ownerLayout.layout.widgets.find((w) => w.size === "XL")?.size, "XL");
    assert.equal(viewerLayout.layout.widgets.find((w) => w.size === "S")?.size, "S");
    assert.ok(!viewerLayout.layout.widgets.some((w) => (w as { id?: string }).id === "budget"));
    const statusViewer = await fetch(`${base}/api/widgets/service-status`, { headers: viewerHeaders });
    assert.equal(statusViewer.status, 403);
    const statusOwner = await fetch(`${base}/api/widgets/service-status`, { headers: ownerHeaders });
    assert.equal(statusOwner.status, 200);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("dashboard layout API: oversize PUT returns 413", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dash-413-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "1" });
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
  const authz = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-ah": "1" };
  try {
    const body = JSON.stringify({ version: 3, widgets: [{ id: "tasks", size: "W", config: { x: "y".repeat(MAX_LAYOUT_BYTES) } }] });
    const res = await fetch(`${base}/api/dashboard-layout`, { method: "PUT", headers: authz, body });
    assert.equal(res.status, 413);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("service-status: HA on loopback reports up and token never leaks", async () => {
  resetServiceStatusCacheForTests();
  const secret = "HA_PLANTED_TOKEN_xyz987654321";
  let haServer: ReturnType<typeof createServer> | undefined;
  await new Promise<void>((resolve) => {
    haServer = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"message":"API running."}');
    });
    haServer!.listen(0, "127.0.0.1", resolve);
  });
  const port = (haServer!.address() as AddressInfo).port;
  const cfg = loadConfig({
    DATA_DIR: "/tmp/unused",
    ALLOW_INSECURE_NO_AUTH: "1",
    HA_URL: `http://127.0.0.1:${port}`,
    HA_TOKEN: secret,
    APP_PUBLIC_URL: "https://dash.example.com",
  });
  const results = await getServiceStatusSnapshot(cfg);
  const ha = results.find((r) => r.id === "home-assistant");
  assert.equal(ha?.state, "up");
  assert.equal(results.find((r) => r.id === "stremmy")?.label, "dash.example.com");
  const json = serviceStatusJson(cfg, results);
  assert.doesNotMatch(json, new RegExp(secret));
  haServer!.close();
});

test("dashboard render does not await slow service checks", async () => {
  resetServiceStatusCacheForTests();
  let haServer: ReturnType<typeof createServer> | undefined;
  await new Promise<void>((resolve) => {
    haServer = createServer(() => {
      /* hang — no response */
    });
    haServer!.listen(0, "127.0.0.1", resolve);
  });
  const port = (haServer!.address() as AddressInfo).port;
  const cfg = loadConfig({
    DATA_DIR: "/tmp/unused",
    HA_URL: `http://127.0.0.1:${port}`,
    HA_TOKEN: "token",
  });
  const layout = defaultDashboardLayout({ showBudget: false, showServiceStatus: true });
  const start = Date.now();
  await buildDashboardRenderContext({ cfg }, layout, false);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1500, `render waited ${elapsed}ms on hanging HA`);
  haServer!.close();
});

test("dashboard HTML omits planted HA_TOKEN", async () => {
  const secret = "HA_HTML_LEAK_TOKEN_abc999";
  const dir = await mkdtemp(join(tmpdir(), "cc-dash-html-redact-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    ALLOW_INSECURE_NO_AUTH: "0",
    HA_TOKEN: secret,
    HA_URL: "http://127.0.0.1:9",
    OWNER_EMAILS: "owner@example.com",
    CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-audience",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const integration = await openIntegrationStores(dir, cfg);
  const auth = makeAuthenticator(cfg, async () => ({ email: "owner@example.com" }));
  const server = createApp({
    cfg,
    auth,
    settings,
    dailyBriefing: await DailyBriefingService.open(dir, cfg.tz),
    notes: await NotesStore.open(dir),
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/`, {
      headers: { "cf-access-jwt-assertion": "owner-jwt" },
    });
    const html = await res.text();
    assert.doesNotMatch(html, new RegExp(secret));
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy dashboard-layout.json migrates only for owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dash-legacy-owner-"));
  try {
    const legacy = JSON.stringify({
      version: 2,
      panels: [{ id: "weather", x: 0, y: 0, w: 3, h: 3 }],
    });
    await writeFile(join(dir, "dashboard-layout.json"), legacy);
    const cfg = loadConfig({ DATA_DIR: dir, OWNER_EMAILS: "owner@example.com" });
    const store = await DashboardLayoutStore.open(dir, cfg);
    const viewer = await store.getForUser({ who: "viewer@example.com", email: "viewer@example.com", owner: false }, false, false);
    assert.ok(viewer.widgets.length > 5);
    assert.ok(!viewer.widgets.every((w) => w.id === "weather"));
    const owner = await store.getForUser({ who: "owner@example.com", email: "owner@example.com", owner: true }, false, false);
    assert.ok(owner.widgets.some((w) => w.id === "weather"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
