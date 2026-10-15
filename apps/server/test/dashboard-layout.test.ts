import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { AiSecurityService } from "../src/ai-security/service";
import { BriefingService } from "../src/briefing/service";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { defaultDashboardLayout } from "../src/dashboard-layout/defaults";
import { normalizeDashboardLayout } from "../src/dashboard-layout/normalize";
import { packAfterMove, rectanglesOverlap } from "../src/dashboard-layout/pack";
import { DashboardLayoutStore } from "../src/dashboard-layout/storage";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { NewsPrefsStore } from "../src/feeds/news-prefs";
import { FeedsStore } from "../src/feeds/store";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { panels } from "../src/panels/registry";
import { SettingsStore } from "../src/settings";
import { openIntegrationStores } from "./helpers";

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
  assert.ok(next.panels.find((p) => p.id === "tagged-news"));
  assert.ok(next.panels.find((p) => p.id === "daily-briefing"));
  assert.ok(next.panels.find((p) => p.id === "ai-security"));
  const weatherBottom = 3;
  for (const id of ["tagged-news", "daily-briefing", "ai-security"]) {
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
      { id: "feeds", x: 0, y: 0, w: 12, h: 12 },
      { id: "weather", x: 0, y: 0, w: 3, h: 3, collapsed: true },
      { id: "removed-panel", x: 1, y: 1, w: 3, h: 3 },
    ],
  };
  const next = normalizeDashboardLayout(raw, PANEL_IDS);
  assert.equal(next.version, 2);
  assert.equal(next.panels.length, PANEL_IDS.length);
  assert.equal(next.panels.find((p) => p.id === "weather")?.collapsed, true);
  const feeds = next.panels.find((p) => p.id === "feeds")!;
  assert.equal(feeds.w, 12);
  assert.equal(feeds.h, 12);
  assert.ok(!next.panels.some((p) => p.id === "removed-panel"));
});

test("dashboard layout: default collapses low-priority panels and enlarges feeds", () => {
  const layout = defaultDashboardLayout(PANEL_IDS);
  const feeds = layout.panels.find((p) => p.id === "feeds")!;
  assert.ok(feeds.w >= 8 && feeds.h >= 5);
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
  assert.ok(next.panels.find((p) => p.id === "feeds"));
  assert.equal(next.panels.length, PANEL_IDS.length);
});

test("dashboard layout API persists under data dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dash-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "1" });
  const settings = new SettingsStore(dir);
  await settings.load();
  const feeds = await FeedsStore.open(dir);
  const newsPrefs = await NewsPrefsStore.open(dir);
  const briefing = await BriefingService.open(dir, cfg.tz);
  const aiSecurity = await AiSecurityService.open(dir);
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg),
    settings,
    feeds,
    briefing,
    aiSecurity,
    dailyBriefing,
    newsPrefs,
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
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
