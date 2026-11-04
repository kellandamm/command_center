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
import { BoardStore } from "../src/board/store";
import { dayKey } from "../src/store";
import { planTestMonday, planTestSaturday, PLAN_TEST_TZ } from "./day-plan-relative-days";

const TOKEN = "t".repeat(32);

async function ownerServer(boardSeed?: (board: BoardStore) => void) {
  const keys = await createTestCfAccessJwt();
  const dir = await mkdtemp(join(tmpdir(), "cc-dp-persist-"));
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
  if (boardSeed) boardSeed(integration.board);
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
  const ownerJwt = await keys.signEmailJwt("owner@example.com");
  const owner = { "cf-access-jwt-assertion": ownerJwt, "x-ah": "1" };
  const call = (method: string, path: string, body?: unknown) =>
    fetch(base + path, {
      method,
      headers: { ...owner, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const close = async () => {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { call, close };
}

test("day-plan API: weekendOverride survives partial PUT on Saturday", async () => {
  const SAT = planTestSaturday();
  const h = await ownerServer((board) => {
    board.create({ title: "Sat work", dueDate: SAT, estimatedMinutes: 30 });
  });
  try {
    assert.equal((await h.call("GET", `/api/day-plan?day=${SAT}`)).status, 200);
    const o1 = (await (await h.call("PUT", "/api/day-plan", { day: SAT, weekendOverride: true })).json()) as {
      plan: { capacity: { availableMinutes: number; overByMinutes: number } };
    };
    assert.equal(o1.plan.capacity.availableMinutes, 480);
    const o2 = (await (await h.call("PUT", "/api/day-plan", { day: SAT, workStart: "10:00" })).json()) as {
      plan: {
        capacity: { availableMinutes: number; overByMinutes: number };
        workStart: string;
        weekendOverride: boolean;
      };
    };
    assert.equal(o2.plan.weekendOverride, true);
    assert.equal(o2.plan.workStart, "10:00");
    assert.ok(o2.plan.capacity.availableMinutes > 0);
    assert.equal(o2.plan.capacity.overByMinutes, 0);
  } finally {
    await h.close();
  }
});

test("day-plan API: POST generate keeps stored work window", async () => {
  const MON = planTestMonday();
  const h = await ownerServer((board) => {
    board.create({ title: "Mon task", dueDate: MON, estimatedMinutes: 30 });
  });
  try {
    assert.equal((await h.call("GET", `/api/day-plan?day=${MON}`)).status, 200);
    const edited = (await (await h.call("PUT", "/api/day-plan", { day: MON, workEnd: "12:00" })).json()) as {
      plan: { workEnd: string };
    };
    assert.equal(edited.plan.workEnd, "12:00");
    const regen = (await (await h.call("POST", "/api/day-plan/generate", { day: MON })).json()) as {
      plan: { workEnd: string; workStart: string };
    };
    assert.equal(regen.plan.workEnd, "12:00");
    assert.equal(regen.plan.workStart, "09:00");
  } finally {
    await h.close();
  }
});

test("day-plan API: invalid day and range return 400 on all routes", async () => {
  const SAT = planTestSaturday();
  const h = await ownerServer();
  try {
    assert.equal((await h.call("GET", "/api/day-plan?day=not-a-day")).status, 400);
    assert.equal((await h.call("GET", "/api/day-plan?day=")).status, 400);
    assert.equal((await h.call("GET", "/api/day-plan?day=2026-02-30")).status, 400);
    assert.equal((await h.call("POST", "/api/day-plan/generate", { day: "2026-02-30" })).status, 400);
    assert.equal((await h.call("GET", `/api/day-plan?day=${SAT}`)).status, 200);
    assert.equal((await h.call("PUT", "/api/day-plan", { day: "2026-02-30", workStart: "10:00" })).status, 400);
    const today = dayKey(new Date(), PLAN_TEST_TZ);
    const shift = (d: string, n: number) => {
      const [y, m, day] = d.split("-").map(Number);
      return new Date(Date.UTC(y!, m! - 1, day! + n)).toISOString().slice(0, 10);
    };
    assert.equal((await h.call("GET", `/api/day-plan?day=${shift(today, -31)}`)).status, 400);
    assert.equal((await h.call("GET", `/api/day-plan?day=${shift(today, 61)}`)).status, 400);
  } finally {
    await h.close();
  }
});

test("day-plan API: PUT rejects bad work window and override type", async () => {
  const SAT = planTestSaturday();
  const h = await ownerServer();
  try {
    assert.equal((await h.call("GET", `/api/day-plan?day=${SAT}`)).status, 200);
    assert.equal((await h.call("PUT", "/api/day-plan", { day: SAT, workStart: "17:00", workEnd: "09:00" })).status, 400);
    assert.equal((await h.call("PUT", "/api/day-plan", { day: SAT, workStart: "25:00" })).status, 400);
    assert.equal((await h.call("PUT", "/api/day-plan", { day: SAT, weekendOverride: "yes" })).status, 400);
    assert.equal((await h.call("PUT", "/api/day-plan", { day: SAT, extra: true, workStart: "10:00" })).status, 200);
  } finally {
    await h.close();
  }
});

test("day-plan API: PUT unknown day returns 404", async () => {
  const MON = planTestMonday();
  const h = await ownerServer();
  try {
    assert.equal((await h.call("PUT", "/api/day-plan", { day: MON, workStart: "10:00" })).status, 404);
  } finally {
    await h.close();
  }
});
