import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { defaultDashboardLayout } from "../src/dashboard-layout/defaults";
import { normalizeDashboardLayout } from "../src/dashboard-layout/normalize";
import { packAfterMove, rectanglesOverlap } from "../src/dashboard-layout/pack";
import { DashboardLayoutStore } from "../src/dashboard-layout/storage";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { panels } from "../src/panels/registry";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const TOKEN = "d".repeat(32);
const PANEL_IDS = panels.map((p) => p.id);

test("dashboard layout: default includes every registered panel", () => {
  const layout = defaultDashboardLayout(PANEL_IDS);
  assert.deepEqual(layout.panels.map((p) => p.id), PANEL_IDS);
});

test("dashboard layout: pack pushes overlapping panels down", () => {
  const panels = [
    { id: "activity", x: 0, y: 0, w: 6, h: 4 },
    { id: "hobie", x: 0, y: 2, w: 3, h: 3 },
  ];
  const packed = packAfterMove(panels, "activity");
  const a = packed.find((p) => p.id === "activity")!;
  const b = packed.find((p) => p.id === "hobie")!;
  assert.equal(!rectanglesOverlap(a, b), true);
  assert.ok(b.y >= a.y + a.h);
});

test("dashboard layout: missing panels append below saved layout", () => {
  const raw = {
    version: 2,
    cols: 12,
    rowHeight: 32,
    panels: [{ id: "weather", x: 0, y: 0, w: 3, h: 3 }],
  };
  const next = normalizeDashboardLayout(raw, PANEL_IDS);
  assert.ok(next.panels.find((p) => p.id === "daily-briefing"));
  const weatherBottom = 3;
  for (const id of ["calendar", "daily-briefing", "notes"]) {
    const p = next.panels.find((x) => x.id === id)!;
    assert.ok(p.y >= weatherBottom, `${id} should append below saved panels`);
  }
});

test("dashboard layout: v1 saved file maps positions into v2 grid", () => {
  const raw = {
    version: 1,
    cols: 12,
    rowHeight: 36,
    panels: [
      { id: "daily-briefing", x: 0, y: 0, w: 12, h: 12 },
      { id: "feeds", x: 0, y: 5, w: 8, h: 5 },
      { id: "tagged-news", x: 8, y: 5, w: 4, h: 2 },
      { id: "briefing", x: 8, y: 7, w: 4, h: 2 },
      { id: "ai-security", x: 8, y: 9, w: 4, h: 2 },
      { id: "weather", x: 0, y: 0, w: 3, h: 3, collapsed: true },
      { id: "removed-panel", x: 1, y: 1, w: 3, h: 3 },
    ],
  };
  const next = normalizeDashboardLayout(raw, PANEL_IDS);
  assert.equal(next.version, 2);
  assert.equal(next.panels.length, PANEL_IDS.length);
  assert.equal(next.panels.find((p) => p.id === "weather")?.collapsed, true);
  const briefing = next.panels.find((p) => p.id === "daily-briefing")!;
  assert.equal(briefing.w, 12);
  assert.equal(briefing.h, 12);
  for (const id of ["feeds", "tagged-news", "briefing", "ai-security"]) {
    assert.ok(!next.panels.some((p) => p.id === id), id);
  }
  assert.ok(!next.panels.some((p) => p.id === "removed-panel"));
});

test("dashboard layout: default collapses low-priority panels without retired tiles", () => {
  const layout = defaultDashboardLayout(PANEL_IDS);
  assert.ok(layout.panels.find((p) => p.id === "daily-briefing"));
  assert.ok(!layout.panels.find((p) => p.id === "feeds"));
  assert.equal(layout.panels.find((p) => p.id === "calendar")?.collapsed, true);
  assert.equal(layout.panels.find((p) => p.id === "notes")?.collapsed, true);
  const maxEnd = layout.panels.reduce((m, p) => Math.max(m, p.y + (p.collapsed ? 1 : p.h)), 0);
  assert.ok(maxEnd <= 8, "default layout should fit in eight grid rows");
});

test("dashboard layout: normalize adds missing panels and drops unknown ids", () => {
  const raw = {
    version: 2,
    cols: 12,
    rowHeight: 32,
    panels: [{ id: "weather", x: 1, y: 2, w: 3, h: 4, collapsed: true }],
  };
  const next = normalizeDashboardLayout(raw, PANEL_IDS);
  assert.equal(next.panels.find((p) => p.id === "weather")?.collapsed, true);
  assert.ok(next.panels.find((p) => p.id === "daily-briefing"));
  assert.equal(next.panels.length, PANEL_IDS.length);
});

test("dashboard layout API persists under data dir", async () => {
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
    const patch = defaultDashboardLayout(PANEL_IDS);
    patch.panels[0] = { ...patch.panels[0], x: 2, y: 1, w: 4, h: 5 };
    const put = await fetch(`${base}/api/dashboard-layout`, {
      method: "PUT",
      headers: authz,
      body: JSON.stringify(patch),
    });
    assert.equal(put.status, 200);
    const stored = await DashboardLayoutStore.open(dir, PANEL_IDS);
    assert.equal(stored.get().panels[0].x, 2);
    const onDisk = JSON.parse(await readFile(join(dir, "dashboard-layout.json"), "utf8"));
    assert.equal(onDisk.panels[0].x, 2);
    const reset = await fetch(`${base}/api/dashboard-layout/reset`, { method: "POST", headers: authz, body: "{}" });
    assert.equal(reset.status, 200);
    const body: any = await reset.json();
    assert.deepEqual(body.layout.panels.map((p: { id: string }) => p.id), PANEL_IDS);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
