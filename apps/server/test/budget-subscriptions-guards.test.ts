import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { SettingsStore } from "../src/settings";
import { NotesStore } from "../src/notes/store";
import { BudgetStore } from "../src/budget/store";
import { budgetAvailable } from "../src/budget/gate";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const OWNER = "owner@example.com";

async function subHttp(opts: { ownerEmail?: string; gateOff?: boolean }) {
  const dir = await mkdtemp(join(tmpdir(), "cc-sub-guards-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: "1",
    CF_ACCESS_TEAM_DOMAIN: opts.gateOff ? "" : "team.example.com",
    CF_ACCESS_AUD: opts.gateOff ? "" : "aud",
    OWNER_EMAILS: opts.gateOff ? "" : OWNER,
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const budget = budgetAvailable(cfg) ? BudgetStore.open(dir) : undefined;
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async () => ({ email: opts.ownerEmail ?? OWNER })),
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
  return { base, close };
}

test("subscriptions guard: gate off returns 503 before owner check", async () => {
  const h = await subHttp({ gateOff: true, ownerEmail: OWNER });
  try {
    const res = await fetch(`${h.base}/api/budget/subscriptions`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    assert.equal(res.status, 503);
  } finally {
    await h.close();
  }
});

test("subscriptions guard: non-owner gets 403 on subscriptions API", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sub-nonowner-"));
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
    auth: makeAuthenticator(cfg, async () => ({ email: "guest@example.com" })),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/budget/subscriptions`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    assert.equal(res.status, 403);
  } finally {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("subscriptions guard: owner GET uses cache-control no-store", async () => {
  const h = await subHttp({});
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

test("subscriptions guard: scan POST requires CSRF header", async () => {
  const h = await subHttp({});
  try {
    const res = await fetch(`${h.base}/api/budget/subscriptions/scan`, {
      method: "POST",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", origin: "https://evil.example" },
      body: "{}",
    });
    assert.equal(res.status, 403);
  } finally {
    await h.close();
  }
});

test("subscriptions guard: shutdown briefing path has no subscription imports", () => {
  const shutdown = readFileSync(join(process.cwd(), "src/briefing/shutdown-service.ts"), "utf8");
  assert.ok(!shutdown.includes("subscription"));
  assert.ok(!shutdown.includes("Subscription"));
});

test("subscriptions guard: budget routes enforce isBudgetOwner via shared helper", () => {
  const routes = readFileSync(join(process.cwd(), "src/budget/routes.ts"), "utf8");
  assert.match(routes, /isBudgetOwner\(who\)/);
  const subRoutes = readFileSync(join(process.cwd(), "src/budget/subscription-routes.ts"), "utf8");
  assert.ok(!subRoutes.includes("canManageSharedServerState"));
});
