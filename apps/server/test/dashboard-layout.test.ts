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

test("dashboard layout: normalize adds missing panels and drops unknown ids", () => {
  const raw = {
    version: 1,
    cols: 12,
    rowHeight: 36,
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
  const { panelUpdates, hobieQueue, dashboardLayout } = await openIntegrationStores(dir);
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
    panelUpdates,
    hobieQueue,
    dashboardLayout,
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
