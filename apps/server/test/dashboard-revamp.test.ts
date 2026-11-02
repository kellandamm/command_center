import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { defaultDashboardLayout } from "../src/dashboard-layout/defaults";
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

function knownIds(showBudget = true) {
  return widgetIdsForSession({ showBudget });
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
  const fixed = new Date("2026-11-02T19:00:00.000Z"); // 1:00 PM Chicago, 4:00 AM Tokyo next day
  const chicago = agendaNowMarkerPercent(fixed, "America/Chicago");
  const tokyo = agendaNowMarkerPercent(fixed, "Asia/Tokyo");
  assert.ok(Math.abs(chicago - 62.5) < 2, `Chicago marker ${chicago}`);
  assert.equal(tokyo, 0, "Tokyo early morning clamps to window start");
});
