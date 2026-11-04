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
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "./cf-access-jwt";

const TOKEN = "t".repeat(32);
const SAT = "2026-11-07";

test("day-plan API: every route 403s for admin-token/service/non-owner and 200s for CF owner; override wired", async () => {
  const keys = await createTestCfAccessJwt();
  const dir = await mkdtemp(join(tmpdir(), "cc-dp-matrix-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    TZ: "America/Chicago",
    OWNER_EMAILS: "owner@example.com",
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: TEST_CF_AUD,
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board: integration.board });
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, keys.verifier),
    settings,
    dailyBriefing,
    notes,
    calendar,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", "x-ah": "1", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const owner = { "cf-access-jwt-assertion": await keys.signEmailJwt("owner@example.com") };
    const denied: Array<[string, Record<string, string>]> = [
      ["admin-token", { authorization: `Bearer ${TOKEN}` }],
      ["service-token", { "cf-access-jwt-assertion": await keys.signServiceTokenJwt("svc") }],
      ["non-owner", { "cf-access-jwt-assertion": await keys.signEmailJwt("visitor@example.com") }],
    ];
    assert.equal((await call("GET", `/api/day-plan?day=${SAT}`, owner)).status, 200);
    const routes: Array<[string, string, unknown]> = [
      ["GET", `/api/day-plan?day=${SAT}`, undefined],
      ["POST", "/api/day-plan/generate", { day: SAT }],
      ["PUT", "/api/day-plan", { day: SAT, workStart: "10:00" }],
      ["GET", "/api/day-plan/anything", undefined],
    ];
    for (const [method, path, body] of routes) {
      for (const [who, h] of denied) {
        assert.equal((await call(method, path, h, body)).status, 403, `${who} ${method} ${path}`);
      }
    }
    assert.equal((await call("POST", "/api/day-plan/generate", owner, { day: SAT })).status, 200);
    assert.equal((await call("PUT", "/api/day-plan", owner, { day: SAT, workStart: "09:00" })).status, 200);
    assert.equal((await call("GET", "/api/day-plan/anything", owner)).status, 404);
    const post = (await (await call("POST", "/api/day-plan/generate", owner, { day: SAT, weekendOverride: true })).json()) as {
      plan: { capacity: { availableMinutes: number } };
    };
    assert.equal(post.plan.capacity.availableMinutes, 480);
    const put = (await (await call("PUT", "/api/day-plan", owner, { day: SAT, weekendOverride: false })).json()) as {
      plan: { capacity: { availableMinutes: number } };
    };
    assert.equal(put.plan.capacity.availableMinutes, 0);
    const put2 = (await (await call("PUT", "/api/day-plan", owner, { day: SAT, weekendOverride: true })).json()) as {
      plan: { capacity: { availableMinutes: number } };
    };
    assert.equal(put2.plan.capacity.availableMinutes, 480);
    assert.equal(
      (await call("POST", "/api/day-plan/generate", owner, { day: SAT, pad: "x".repeat(40 * 1024) })).status,
      413,
    );
    assert.equal((await call("GET", "/api/day-plan?day=2026-02-30", owner)).status, 400);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
