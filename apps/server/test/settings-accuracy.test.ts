import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { SettingsStore } from "../src/settings";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { NotesStore } from "../src/notes/store";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";
import { canManageSharedServerState, computeOwnerReason } from "../src/owner-auth";

const TOKEN = "t".repeat(32);

async function harness(env: Record<string, string> = {}, owner = false) {
  const dir = await mkdtemp(join(tmpdir(), "cc-settings-acc-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    TZ: "UTC",
    ALLOW_INSECURE_NO_AUTH: "1",
    ...env,
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg,
    auth: owner
      ? async () => ({ ok: true, who: "owner@example.com", owner: true })
      : makeAuthenticator(cfg),
    settings,
    dailyBriefing,
    notes,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, close };
}

const writeHeaders = { authorization: `Bearer ${TOKEN}`, "x-ah": "1", "content-type": "application/json" };

test("canManageSharedServerState: open when OWNER_EMAILS unset; owner or admin-token when set", () => {
  const open = loadConfig({ DATA_DIR: "/tmp/x", ALLOW_INSECURE_NO_AUTH: "1" });
  assert.equal(canManageSharedServerState(open, { owner: false, who: "guest@example.com" }), true);
  const locked = loadConfig({
    DATA_DIR: "/tmp/x",
    ALLOW_INSECURE_NO_AUTH: "1",
    OWNER_EMAILS: "owner@example.com",
    ADMIN_TOKEN: TOKEN,
  });
  assert.equal(canManageSharedServerState(locked, { owner: false, who: "guest@example.com" }), false);
  assert.equal(canManageSharedServerState(locked, { owner: true, who: "owner@example.com" }), true);
  assert.equal(canManageSharedServerState(locked, { owner: false, who: "admin-token" }), true);
});

async function settingsMetaServer(
  env: Record<string, string>,
  verify: (token: string) => Promise<Record<string, unknown>>,
) {
  const dir = await mkdtemp(join(tmpdir(), "cc-settings-meta-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    TZ: "UTC",
    ALLOW_INSECURE_NO_AUTH: "1",
    ...env,
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, verify),
    settings,
    dailyBriefing,
    notes,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  const accessHeaders = { "cf-access-jwt-assertion": "signed-access-jwt", "x-ah": "1" };
  return { base, close, accessHeaders, cfg };
}

test("settings API meta: ownerReason and signedInAs from Access JWT (no OWNER_EMAILS leak)", async () => {
  const ownerList = "owner@example.com, hidden-owner@corp.com";
  const cases: Array<{ payload: Record<string, unknown>; reason: string; canManage: boolean; signedInAs: string }> = [
    { payload: { email: " Owner@Example.com " }, reason: "owner", canManage: true, signedInAs: " Owner@Example.com " },
    { payload: { email: "visitor@example.com" }, reason: "email-not-in-owner-emails", canManage: false, signedInAs: "visitor@example.com" },
    { payload: { sub: "user-uuid-no-email" }, reason: "no-email-claim", canManage: false, signedInAs: "user-uuid-no-email" },
    { payload: { email: "owner@example.com", common_name: "svc" }, reason: "service-token", canManage: false, signedInAs: "owner@example.com" },
  ];
  for (const { payload, reason, canManage, signedInAs } of cases) {
    const h = await settingsMetaServer({ OWNER_EMAILS: ownerList }, async () => payload);
    try {
      const res = await fetch(`${h.base}/api/settings`, { headers: h.accessHeaders });
      const body = await res.json();
      assert.equal(body.meta.ownerReason, reason);
      assert.equal(body.meta.signedInAs, signedInAs);
      assert.equal(body.meta.canManage, canManage);
      const raw = JSON.stringify(body);
      assert.ok(!raw.includes("hidden-owner@corp.com"));
      assert.ok(!raw.includes(ownerList));
    } finally {
      await h.close();
    }
  }
  const admin = await settingsMetaServer({ OWNER_EMAILS: ownerList }, async () => {
    throw new Error("no jwt");
  });
  try {
    const res = await fetch(`${admin.base}/api/settings`, {
      headers: { authorization: `Bearer ${TOKEN}`, "x-ah": "1" },
    });
    const body = await res.json();
    assert.equal(body.meta.ownerReason, "admin-token");
    assert.equal(body.meta.signedInAs, "admin-token");
    assert.equal(body.meta.canManage, true);
    assert.ok(!JSON.stringify(body).includes("hidden-owner@corp.com"));
  } finally {
    await admin.close();
  }
});

test("computeOwnerReason: matches canManageSharedServerState boundaries", () => {
  const locked = loadConfig({
    DATA_DIR: "/tmp/x",
    ALLOW_INSECURE_NO_AUTH: "1",
    OWNER_EMAILS: "owner@example.com",
    ADMIN_TOKEN: TOKEN,
  });
  assert.equal(computeOwnerReason(locked, { owner: true, who: "owner@example.com", email: "owner@example.com" }), "owner");
  assert.equal(computeOwnerReason(locked, { owner: false, who: "admin-token" }), "admin-token");
  assert.equal(
    computeOwnerReason(locked, { owner: false, who: "other@example.com", email: "other@example.com" }),
    "email-not-in-owner-emails",
  );
  const req = new IncomingMessage(new Socket());
  req.headers["cf-access-jwt-assertion"] = "t";
  return makeAuthenticator(locked, async () => ({ email: " Owner@Example.com " }))(req, new URL("https://app.test")).then((r) => {
    assert.equal(r.ok && r.owner, true);
    if (r.ok) {
      assert.equal(computeOwnerReason(locked, { owner: r.owner, who: r.who, email: r.email, serviceToken: r.serviceToken }), "owner");
    }
  });
});

test("settings API: meta.features and canManage reflect deployment", async () => {
  const h = await harness({ OWNER_EMAILS: "owner@example.com", SHARE_LINKS_ENABLED: "1", WHITEBOARD_ENABLED: "true" });
  try {
    const res = await fetch(`${h.base}/api/settings`, { headers: writeHeaders });
    const body = await res.json();
    assert.equal(body.meta.canManage, true);
    assert.equal(body.meta.ownerEmailsConfigured, true);
    assert.equal(body.meta.features.shareLinksEnabled, true);
    assert.equal(body.meta.features.whiteboardEnabled, true);
    assert.equal((await fetch(`${h.base}/api/settings`, { method: "PUT", headers: writeHeaders, body: "{}" })).status, 200);
  } finally {
    await h.close();
  }
});

test("settings API: non-owner Access session cannot write when OWNER_EMAILS is set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-settings-acc-guest-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    TZ: "UTC",
    ALLOW_INSECURE_NO_AUTH: "1",
    OWNER_EMAILS: "owner@example.com",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg,
    auth: async () => ({ ok: true, who: "visitor@example.com", owner: false, email: "visitor@example.com" }),
    settings,
    dailyBriefing,
    notes,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const get = await fetch(`${base}/api/settings`, { headers: { "x-ah": "1" } });
    const body = await get.json();
    assert.equal(body.meta.canManage, false);
    assert.equal(body.meta.ownerReason, "email-not-in-owner-emails");
    assert.equal(body.meta.signedInAs, "visitor@example.com");
    const put = await fetch(`${base}/api/settings`, {
      method: "PUT",
      headers: { "x-ah": "1", "content-type": "application/json" },
      body: JSON.stringify({ briefingTime: "07:30" }),
    });
    assert.equal(put.status, 403);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("settings API: owner can update; retired dashboard prefs are stripped", async () => {
  const h = await harness({ OWNER_EMAILS: "owner@example.com" }, true);
  try {
    const put = await fetch(`${h.base}/api/settings`, {
      method: "PUT",
      headers: writeHeaders,
      body: JSON.stringify({
        viewPreferences: { dashboard: { hobie: false }, notes: { fontSize: "large" } },
      }),
    });
    assert.equal(put.status, 200);
    const saved = (await put.json()).settings;
    assert.equal("dashboard" in saved.viewPreferences, false);
    assert.equal(saved.viewPreferences.notes.fontSize, "large");
    const get = await fetch(`${h.base}/api/settings`, { headers: writeHeaders });
    const body = await get.json();
    assert.equal(body.meta.canManage, true);
  } finally {
    await h.close();
  }
});

test("dashboard layout and capture tokens accept ADMIN_TOKEN when OWNER_EMAILS is set", async () => {
  const h = await harness({ OWNER_EMAILS: "owner@example.com", ADMIN_TOKEN: TOKEN });
  try {
    const layoutPut = await fetch(`${h.base}/api/dashboard-layout`, {
      method: "PUT",
      headers: writeHeaders,
      body: JSON.stringify({ version: 2, cols: 12, rowHeight: 32, panels: [] }),
    });
    assert.equal(layoutPut.status, 200);
    const capturePost = await fetch(`${h.base}/api/capture/access`, { method: "POST", headers: writeHeaders, body: "{}" });
    assert.equal(capturePost.status, 201);
  } finally {
    await h.close();
  }
});
