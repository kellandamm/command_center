import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";
import { CalendarWorkspace } from "../src/calendar/workspace";
import { BoardStore } from "../src/board/store";
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "./cf-access-jwt";

const TOKEN = "t".repeat(32);
const authz = { authorization: `Bearer ${TOKEN}`, "x-ah": "1" };

async function harness(
  env: Record<string, string> = {},
  owner = false,
  verifyJwt?: (token: string) => Promise<import("jose").JWTPayload>,
) {
  const dir = await mkdtemp(join(tmpdir(), "cc-day-plan-api-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    TZ: "UTC",
    ...env,
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board: integration.board });
  const server = createApp({
    cfg,
    auth: owner
      ? async () => ({ ok: true, who: "owner@example.com", owner: true, email: "owner@example.com" })
      : makeAuthenticator(cfg, verifyJwt),
    settings,
    dailyBriefing,
    notes,
    calendar,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, close, board: integration.board, cfg };
}

test("day-plan API: owner matrix and deterministic GET generate-on-miss", async () => {
  const keys = await createTestCfAccessJwt();
  const locked = await harness(
    { OWNER_EMAILS: "owner@example.com", CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM, CF_ACCESS_AUD: TEST_CF_AUD },
    false,
    keys.verifier,
  );
  try {
    const visitorJwt = await keys.signEmailJwt("visitor@example.com");
    const visitorHeaders = { "cf-access-jwt-assertion": visitorJwt, "x-ah": "1" };
    assert.equal((await fetch(`${locked.base}/api/day-plan`, { headers: visitorHeaders })).status, 403);
    assert.equal((await fetch(`${locked.base}/api/day-plan`, { headers: authz })).status, 403);
    const serviceJwt = await keys.signServiceTokenJwt("svc-bot");
    assert.equal(
      (await fetch(`${locked.base}/api/day-plan`, { headers: { "cf-access-jwt-assertion": serviceJwt, "x-ah": "1" } }))
        .status,
      403,
    );
  } finally {
    await locked.close();
  }

  const emptyOwners = await harness({ OWNER_EMAILS: "", ALLOW_INSECURE_NO_AUTH: "1", ADMIN_TOKEN: "" }, false);
  try {
    assert.equal((await fetch(`${emptyOwners.base}/api/day-plan`, { headers: { "x-ah": "1" } })).status, 403);
  } finally {
    await emptyOwners.close();
  }

  const ownerHarness = await harness({ OWNER_EMAILS: "owner@example.com" }, true);
  try {
    ownerHarness.board.create({ title: "Due", dueDate: "2026-06-20" });
    const get = await fetch(`${ownerHarness.base}/api/day-plan?day=2026-06-20`, { headers: { "x-ah": "1" } });
    assert.equal(get.status, 200);
    const body = (await get.json()) as {
      day: string;
      plan: { generatedBy: string; alternates: unknown[]; rolledToTomorrow: unknown[]; mustDos: unknown[] };
    };
    assert.equal(body.day, "2026-06-20");
    assert.equal(body.plan.generatedBy, "deterministic");
    assert.ok(Array.isArray(body.plan.alternates));
    assert.ok(Array.isArray(body.plan.rolledToTomorrow));
    assert.equal(body.plan.mustDos.length, 1);
    const regen = await fetch(`${ownerHarness.base}/api/day-plan/generate`, {
      method: "POST",
      headers: { "x-ah": "1", "content-type": "application/json" },
      body: JSON.stringify({ day: "2026-06-20" }),
    });
    assert.equal(regen.status, 200);
    const postNoCsrf = await fetch(`${ownerHarness.base}/api/day-plan/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(postNoCsrf.status, 403);
  } finally {
    await ownerHarness.close();
  }
});

test("day-plan API: admin-token cannot use canManageSharedServerState as owner", async () => {
  const h = await harness({ OWNER_EMAILS: "owner@example.com" }, false);
  try {
    const res = await fetch(`${h.base}/api/day-plan`, { headers: authz });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /owner login/i);
  } finally {
    await h.close();
  }
});
