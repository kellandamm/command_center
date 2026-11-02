import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { defaultDashboardLayout } from "../src/dashboard-layout/defaults";
import { normalizeDashboardLayout } from "../src/dashboard-layout/normalize";
import { overlappingPanelPairs, packWidgetFlow } from "../src/dashboard-layout/pack";
import { DashboardLayoutStore } from "../src/dashboard-layout/storage";
import { inferSizeFromLegacy } from "../src/dashboard-layout/sizes";
import { widgetIdsForSession } from "../src/dashboard-layout/widgets";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const TOKEN = "d".repeat(32);

test("dashboard layout: default includes core widgets", () => {
  const layout = defaultDashboardLayout({ showBudget: true });
  assert.ok(layout.widgets.some((w) => w.id === "today-agenda"));
  assert.ok(layout.widgets.some((w) => w.id === "tasks"));
  assert.deepEqual(overlappingPanelPairs(layout.panels), []);
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

test("dashboard layout: v2 panels migrate to v3 sizes", () => {
  const ids = widgetIdsForSession({ showBudget: true });
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

test("dashboard layout: normalize adds new registry widgets on load", () => {
  const ids = widgetIdsForSession({ showBudget: false });
  const raw = { version: 3, widgets: [{ id: "tasks", size: "W" as const }] };
  const next = normalizeDashboardLayout(raw, ids, false, { appendMissing: true });
  assert.ok(next.widgets.find((w) => w.id === "today-agenda"));
  assert.ok(next.widgets.length > 1);
});

test("dashboard layout API persists per user file", async () => {
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
    const stored = await DashboardLayoutStore.open(dir);
    const layout = await stored.getForUser({ who: "admin-token" }, false);
    assert.equal(layout.widgets.find((w) => w.id === "tasks")?.size, "L");
    const files = await readFile(join(dir, "dashboard-layouts", "admin-token.json"), "utf8");
    assert.match(files, /"size": "L"/);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
