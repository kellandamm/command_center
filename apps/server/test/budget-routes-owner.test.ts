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
import { OWNER_ACTION_FORBIDDEN } from "../src/owner-auth";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const OWNER = "owner@example.com";

async function openBudgetHttp(opts?: { ownerEmail?: string; insecure?: boolean }) {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-routes-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: opts?.insecure ? "1" : undefined,
    CF_ACCESS_TEAM_DOMAIN: "team.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: OWNER,
    ADMIN_TOKEN: "t".repeat(32),
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const budget = BudgetStore.open(dir);
  const auth = opts?.ownerEmail
    ? makeAuthenticator(cfg, async () => ({ email: opts.ownerEmail! }))
    : makeAuthenticator(cfg);
  const server = createApp({
    cfg,
    auth,
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, close, budget };
}

test("budget routes owner: admin token gets 403 OWNER_ACTION_FORBIDDEN", async () => {
  const admin = "a".repeat(32);
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-routes-admin-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    CF_ACCESS_TEAM_DOMAIN: "team.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: OWNER,
    ADMIN_TOKEN: admin,
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
    auth: makeAuthenticator(cfg),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/budget/rollup`, {
      headers: { authorization: `Bearer ${admin}`, "x-ah": "1" },
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, OWNER_ACTION_FORBIDDEN);
  } finally {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget routes owner: anonymous gets 401", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-routes-anon-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
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
    auth: makeAuthenticator(cfg),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/budget/net-worth`, { headers: { "x-ah": "1" } });
    assert.equal(res.status, 401);
  } finally {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget routes owner: owner responses include Cache-Control no-store", async () => {
  const h = await openBudgetHttp({ ownerEmail: OWNER, insecure: true });
  try {
    const res = await fetch(`${h.base}/api/budget/rollup`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get("cache-control")), /no-store/);
  } finally {
    await h.close();
  }
});

test("budget routes owner: owner can read rollup and net-worth", async () => {
  const h = await openBudgetHttp({ ownerEmail: OWNER, insecure: true });
  try {
    const acct = h.budget.createAccount({ name: "Checking", type: "checking", openingBalanceCents: 1000 });
    h.budget.createTransaction({ accountId: acct.id, date: "2026-05-01", amountCents: -500 });
    const nw = await fetch(`${h.base}/api/budget/net-worth`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    assert.equal(nw.status, 200);
    const nwBody = (await nw.json()) as { totalCents: number; equityLabel: string };
    assert.equal(nwBody.totalCents, 500);
    assert.match(nwBody.equityLabel, /Equity coming soon/);
    const rollup = await fetch(`${h.base}/api/budget/rollup?month=2026-05`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    assert.equal(rollup.status, 200);
  } finally {
    await h.close();
  }
});

test("budget routes owner: subscriptions list is owner-only with no-store", async () => {
  const h = await openBudgetHttp({ ownerEmail: OWNER, insecure: true });
  try {
    const res = await fetch(`${h.base}/api/budget/subscriptions`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get("cache-control")), /no-store/);
  } finally {
    await h.close();
  }
});
