import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { defaultDashboardLayout } from "../src/dashboard-layout/defaults";
import { normalizeDashboardLayout } from "../src/dashboard-layout/normalize";
import { overlappingPanelPairs, packAfterMove, packWidgetFlow, rectanglesOverlap } from "../src/dashboard-layout/pack";
import { DashboardLayoutStore, dashboardLayoutUserKey } from "../src/dashboard-layout/storage";
import { inferSizeFromLegacy } from "../src/dashboard-layout/sizes";
import { MAX_LAYOUT_BYTES } from "../src/dashboard-layout/schema";
import { catalogWidgets, DRAWER_BLOCKLIST, widgetIdsForSession } from "../src/dashboard-layout/widgets";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const TOKEN = "d".repeat(32);

test("dashboard layout: default includes core widgets without focus timer", () => {
  const layout = defaultDashboardLayout({ showBudget: true, showServiceStatus: true });
  assert.ok(layout.widgets.some((w) => w.id === "today-agenda"));
  assert.ok(!layout.widgets.some((w) => w.id === "focus"));
  assert.deepEqual(overlappingPanelPairs(layout.panels), []);
});

test("dashboard layout: drawer lists removable panels and blocks focus/pomodoro", () => {
  const catalog = catalogWidgets({ showBudget: true, showServiceStatus: true });
  for (const id of ["attention", "heatmap", "hobie", "agents-usage", "host-health", "recallio"]) {
    assert.ok(catalog.some((w) => w.id === id), id);
  }
  assert.ok(!catalog.some((w) => w.id === "budget"));
  for (const blocked of DRAWER_BLOCKLIST) {
    assert.ok(!catalog.some((w) => w.id === blocked));
  }
});

test("dashboard layout: flow pack avoids overlaps", () => {
  const widgets = [
    { id: "today-agenda", size: "XL" as const },
    { id: "tasks", size: "W" as const },
    { id: "weather", size: "S" as const },
  ];
  const panels = packWidgetFlow(widgets);
  assert.deepEqual(overlappingPanelPairs(panels), []);
});

test("dashboard layout: pack pushes overlapping panels down", () => {
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

test("dashboard layout: v2 panels migrate to v3 sizes", () => {
  const ids = widgetIdsForSession({ showBudget: true, showServiceStatus: true });
  const raw = {
    version: 2,
    cols: 12,
    panels: [
      { id: "daily-briefing", x: 0, y: 0, w: 12, h: 2 },
      { id: "weather", x: 0, y: 2, w: 3, h: 1 },
    ],
  };
  const next = normalizeDashboardLayout(raw, ids, true);
  assert.equal(next.version, 3);
  assert.equal(next.widgets.find((w) => w.id === "daily-briefing")?.size, inferSizeFromLegacy(12, 2));
});

test("dashboard layout: registry epoch appends only new widgets not removed ones", () => {
  const ids = widgetIdsForSession({ showBudget: false, showServiceStatus: true });
  const raw = { version: 3, registryEpoch: 1, widgets: [{ id: "tasks", size: "W" as const }] };
  const next = normalizeDashboardLayout(raw, ids, false, { appendMissing: false, appendNewRegistryWidgets: true });
  assert.ok(next.widgets.some((w) => w.id === "tasks"));
  assert.ok(!next.widgets.some((w) => w.id === "heatmap"));
});

test("dashboard layout: normalize drops unknown ids", () => {
  const ids = widgetIdsForSession({ showBudget: false, showServiceStatus: true });
  const raw = { version: 3, widgets: [{ id: "weather", size: "S" as const }, { id: "bogus", size: "W" as const }] };
  const next = normalizeDashboardLayout(raw, ids, false, { appendMissing: false, appendNewRegistryWidgets: false });
  assert.ok(next.widgets.some((w) => w.id === "weather"));
  assert.ok(!next.widgets.some((w) => w.id === "bogus"));
});

test("dashboard layout store: removed widget stays removed after fresh store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dash-removed-"));
  try {
    const principal = { who: "user@example.com", email: "user@example.com", owner: true };
    const store1 = await DashboardLayoutStore.open(dir, loadConfig({ DATA_DIR: dir, OWNER_EMAILS: "user@example.com" }));
    const saved = await store1.updateForUser(
      principal,
      { version: 3, registryEpoch: 1, widgets: [{ id: "tasks", size: "W" }] },
      false,
      true,
    );
    assert.ok(!saved.widgets.some((w) => w.id === "heatmap"));
    const store2 = await DashboardLayoutStore.open(dir, loadConfig({ DATA_DIR: dir, OWNER_EMAILS: "user@example.com" }));
    const reloaded = await store2.getForUser(principal, false, true);
    assert.ok(reloaded.widgets.some((w) => w.id === "tasks"));
    assert.ok(!reloaded.widgets.some((w) => w.id === "heatmap"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dashboard layout store: corrupt and oversize files fall back to default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dash-corrupt-"));
  try {
    const cfg = loadConfig({ DATA_DIR: dir });
    const key = dashboardLayoutUserKey({ who: "a@x.com", email: "a@x.com" });
    await mkdir(join(dir, "dashboard-layouts"), { recursive: true });
    await writeFile(join(dir, "dashboard-layouts", `${key}.json`), "{not-json");
    const store = await DashboardLayoutStore.open(dir, cfg);
    const layout = await store.getForUser({ who: "a@x.com", email: "a@x.com" }, false, false);
    assert.ok(layout.widgets.length > 3);
    const huge = " ".repeat(MAX_LAYOUT_BYTES + 100);
    await writeFile(join(dir, "dashboard-layouts", `${key}.json`), huge);
    const layout2 = await store.getForUser({ who: "a@x.com", email: "a@x.com" }, false, false);
    assert.ok(layout2.widgets.length > 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dashboard layout API persists per user file with hashed key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dash-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "1" });
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
  const authz = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-ah": "1" };
  try {
    const patch = { version: 3, widgets: [{ id: "tasks", size: "L" as const }] };
    const put = await fetch(`${base}/api/dashboard-layout`, {
      method: "PUT",
      headers: authz,
      body: JSON.stringify(patch),
    });
    assert.equal(put.status, 200);
    const key = dashboardLayoutUserKey({ who: "admin-token" });
    const files = await readFile(join(dir, "dashboard-layouts", `${key}.json`), "utf8");
    assert.match(files, /"size": "L"/);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
