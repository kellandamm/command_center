import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { SettingsStore } from "../src/settings";
import { NotesStore } from "../src/notes/store";
import { BudgetStore } from "../src/budget/store";
import { budgetPanelVisible } from "../src/budget/gate";
import { BUDGET_AMOUNTS_BLUR_CLASS, budgetPanelDashboardCss } from "../src/panels/budget";
import { dashboardPage } from "../src/ui/dashboard-page";
import { defaultDashboardLayout } from "../src/dashboard-layout/defaults";
import { panels } from "../src/panels/registry";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const OWNER = "owner@example.com";

test("budget panel: owner dashboard HTML includes blur class", () => {
  const html = dashboardPage([], { showBudgetPanel: true });
  assert.match(html, new RegExp(BUDGET_AMOUNTS_BLUR_CLASS));
  assert.match(budgetPanelDashboardCss(), /filter:\s*blur\(/);
  assert.match(html, /panel-budget/);
  assert.match(html, /Equity coming soon/);
});

test("budget panel: hidden when gate off or non-owner", () => {
  const cfg = loadConfig({
    CF_ACCESS_TEAM_DOMAIN: "team.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: OWNER,
  });
  assert.equal(budgetPanelVisible(cfg, true), true);
  assert.equal(budgetPanelVisible(cfg, false), false);
  const gatedOff = loadConfig({});
  assert.equal(budgetPanelVisible(gatedOff, true), false);

  const htmlOwnerOff = dashboardPage([], { showBudgetPanel: false });
  assert.ok(!htmlOwnerOff.includes('data-panel-id="budget"'));
  assert.ok(!htmlOwnerOff.includes("loadBudgetPanel"));

  const layoutOff = defaultDashboardLayout(panels.map((p) => p.id).filter((id) => id !== "budget"));
  assert.ok(!layoutOff.panels.some((p) => p.id === "budget"));
});

test("budget panel: API returns no-store summary for owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-panel-api-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: "1",
    CF_ACCESS_TEAM_DOMAIN: "team.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: OWNER,
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const budget = BudgetStore.open(dir);
  budget.createAccount({ name: "Checking", type: "checking", openingBalanceCents: 4200 });
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async () => ({ email: OWNER })),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/panels/budget`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get("cache-control")), /no-store/);
    const body = (await res.json()) as { netWorthCents: number; equityLabel: string };
    assert.equal(body.netWorthCents, 4200);
    assert.match(body.equityLabel, /Equity coming soon/);
  } finally {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget panel: non-owner fetch is not handled (404)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-panel-403-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: "1",
    CF_ACCESS_TEAM_DOMAIN: "team.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: OWNER,
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const budget = BudgetStore.open(dir);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async () => ({ email: "other@example.com" })),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/panels/budget`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    assert.equal(res.status, 404);
  } finally {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
