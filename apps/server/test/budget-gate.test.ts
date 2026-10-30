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
import { budgetAvailable } from "../src/budget/gate";
import { BudgetStore } from "../src/budget/store";
import { visibleNavTabs } from "../src/nav-tabs";
import { DEFAULT_SIDEBAR_TABS } from "../src/nav-tabs";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const OWNER = "owner@example.com";

async function budgetServer(extra: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-gate-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: "1",
    CF_ACCESS_TEAM_DOMAIN: "team.example.com",
    CF_ACCESS_AUD: "test-aud",
    OWNER_EMAILS: OWNER,
    TZ: "UTC",
    ...extra,
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const budget = budgetAvailable(cfg) ? BudgetStore.open(dir) : undefined;
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
  const close = async () => {
    budget?.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, cfg, close, budget };
}

const ownerHeaders = { cookie: "CF_Authorization=token", "x-ah": "1" };

test("budget gate: budgetAvailable requires CF Access and owner emails", () => {
  const full = loadConfig({
    DATA_DIR: "/tmp/x",
    CF_ACCESS_TEAM_DOMAIN: "t.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: OWNER,
  });
  assert.equal(budgetAvailable(full), true);
  assert.equal(budgetAvailable(loadConfig({ DATA_DIR: "/tmp/x", OWNER_EMAILS: OWNER })), false);
});

test("budget gate: disabled returns 404 page and 503 API", async () => {
  const h = await budgetServer({ OWNER_EMAILS: "" });
  try {
    const page = await fetch(`${h.base}/budget`, { headers: ownerHeaders });
    assert.equal(page.status, 404);
    const api = await fetch(`${h.base}/api/budget/accounts`, { headers: ownerHeaders });
    assert.equal(api.status, 503);
    const body = (await api.json()) as { error: string };
    assert.match(body.error, /Budget is not enabled/i);
    const nav = visibleNavTabs(DEFAULT_SIDEBAR_TABS, { budget: false });
    assert.ok(!nav.some((t) => t.href === "/budget"));
  } finally {
    await h.close();
  }
});

test("budget gate: enabled exposes nav and opens store", async () => {
  const h = await budgetServer();
  try {
    assert.ok(h.budget);
    const nav = visibleNavTabs(DEFAULT_SIDEBAR_TABS, { budget: true });
    assert.ok(nav.some((t) => t.href === "/budget"));
    const page = await fetch(`${h.base}/budget`, { headers: ownerHeaders });
    assert.equal(page.status, 200);
  } finally {
    await h.close();
  }
});

test("budget gate: non-owner dashboard omits Budget nav link", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-nav-"));
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
    const home = await fetch(`${base}/`, { headers: ownerHeaders });
    const html = await home.text();
    assert.doesNotMatch(html, /href="\/budget"/);
  } finally {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
