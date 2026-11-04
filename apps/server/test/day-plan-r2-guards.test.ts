import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { dayKey } from "../src/store";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";
import { CalendarWorkspace } from "../src/calendar/workspace";
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "./cf-access-jwt";
import {
  dayParamFromQuery,
  parseCalendarDay,
  resolvePlanPrefs,
} from "../src/day-plan/validate";
import { DayPlanStore } from "../src/day-plan/store";
import { DAY_PLAN_DB } from "../src/day-plan/db";
import { buildDeterministicPlan } from "../src/day-plan/planner";

const TZ = "America/Chicago";
const shift = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
};
const inRange = (d: string, now: string, tz = TZ) => {
  try {
    dayParamFromQuery(d, tz, new Date(now));
    return true;
  } catch {
    return false;
  }
};

test("day-plan validate: strict calendar day and resolvePlanPrefs without existing", () => {
  assert.equal(parseCalendarDay("2026-02-30"), null);
  assert.equal(parseCalendarDay("2026-13-01"), null);
  assert.equal(parseCalendarDay("26-06-01"), null);
  assert.deepEqual(resolvePlanPrefs(null, {}), {
    workStart: "09:00",
    workEnd: "17:00",
    weekendOverride: false,
  });
});

test("day-plan range: today-30..+60 inclusive in cfg.tz, near midnight and across DST", () => {
  assert.equal(inRange("2026-10-05", "2026-11-05T05:59:00Z"), true);
  assert.equal(inRange("2026-10-04", "2026-11-05T05:59:00Z"), false);
  assert.equal(inRange("2027-01-03", "2026-11-05T05:59:00Z"), true);
  assert.equal(inRange("2027-01-04", "2026-11-05T05:59:00Z"), false);
  assert.equal(inRange("2026-10-05", "2026-11-05T06:00:00Z"), false);
  assert.equal(inRange("2027-01-04", "2026-11-05T06:00:00Z"), true);
  assert.equal(inRange("2026-10-02", "2026-11-01T07:30:00Z"), true);
  assert.equal(inRange("2026-10-01", "2026-11-01T07:30:00Z"), false);
  assert.equal(inRange("2027-05-13", "2027-03-14T08:30:00Z"), true);
  assert.equal(inRange("2027-05-14", "2027-03-14T08:30:00Z"), false);
});

async function harness() {
  const keys = await createTestCfAccessJwt();
  const dir = await mkdtemp(join(tmpdir(), "cc-dp-r2-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    TZ,
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
  const owner = { "cf-access-jwt-assertion": await keys.signEmailJwt("owner@example.com") };
  const call = (method: string, path: string, body?: unknown) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", "x-ah": "1", ...owner },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    call,
    integration,
    close: async () => {
      await closeIntegrationServer(server, integration);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("day-plan API r2: range on every route, strict day, POST override type, workStart reuse, generic 500", async () => {
  const h = await harness();
  const today = dayKey(new Date(), TZ);
  try {
    for (const d of [shift(today, -31), shift(today, 61)]) {
      assert.equal((await h.call("GET", `/api/day-plan?day=${d}`)).status, 400, `GET ${d}`);
      assert.equal((await h.call("POST", "/api/day-plan/generate", { day: d })).status, 400, `POST ${d}`);
      assert.equal((await h.call("PUT", "/api/day-plan", { day: d, workStart: "09:00" })).status, 400, `PUT ${d}`);
    }
    for (const d of [shift(today, -30), shift(today, 60)])
      assert.equal((await h.call("GET", `/api/day-plan?day=${d}`)).status, 200, `GET ${d}`);
    assert.equal((await h.call("GET", "/api/day-plan?day=")).status, 400);
    assert.equal((await h.call("GET", `/api/day-plan?day=%20${today}`)).status, 400);
    assert.equal((await h.call("GET", `/api/day-plan?day=${today.slice(0, 8)}0${today.slice(8)}`)).status, 400);
    assert.equal((await h.call("GET", `/api/day-plan?day=${today.slice(0, 8)}32`)).status, 400);
    assert.equal((await h.call("POST", "/api/day-plan/generate", { day: today, weekendOverride: "yes" })).status, 400);

    assert.equal((await h.call("GET", `/api/day-plan?day=${today}`)).status, 200);
    assert.equal((await h.call("PUT", "/api/day-plan", { day: today, workStart: "10:00" })).status, 200);
    const regen = (await (await h.call("POST", "/api/day-plan/generate", { day: today })).json()) as {
      plan: { workStart: string };
    };
    assert.equal(regen.plan.workStart, "10:00");

    const save = h.integration.dayPlan.save.bind(h.integration.dayPlan);
    h.integration.dayPlan.save = () => {
      throw new Error("boom TASK_TITLE");
    };
    const res = await h.call("PUT", "/api/day-plan", { day: today, workStart: "09:00" });
    assert.equal(res.status, 500);
    const errBody = (await res.json()) as { error: string };
    assert.deepEqual(errBody, { error: "internal error" });
    assert.ok(!JSON.stringify(errBody).includes("TASK_TITLE"));
    h.integration.dayPlan.save = save;
  } finally {
    await h.close();
  }
});

test("day-plan schema v1 -> v2 keeps plans and LLM claims and adds weekend_override", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dp-mig-"));
  try {
    const day = "2026-11-07";
    const ctx = {
      day,
      tz: TZ,
      occurrences: [],
      allDayLabels: [],
      sources: { calendarUnavailable: false, todoistUnavailable: false },
      tasks: [
        {
          source: "board" as const,
          id: "a",
          title: "A",
          priority: 1,
          dueDay: day,
          estimateMinutes: 30,
          scheduled: false,
        },
      ],
    };
    const s0 = DayPlanStore.open(dir);
    s0.save(buildDeterministicPlan({ context: ctx, workStart: "10:00", workEnd: "15:00" }));
    assert.equal(s0.claimLlmAttempt(day, "auto", "t1"), true);
    s0.close();
    const raw = new DatabaseSync(join(dir, DAY_PLAN_DB));
    raw.exec("ALTER TABLE plan_days DROP COLUMN weekend_override; PRAGMA user_version = 1;");
    raw.close();
    const s = DayPlanStore.open(dir);
    try {
      assert.equal(s.load(day)?.workStart, "10:00");
      assert.equal(s.claimLlmAttempt(day, "auto", "t2"), false);
      s.save(buildDeterministicPlan({ context: ctx, workStart: "10:00", workEnd: "15:00", weekendOverride: true }));
      assert.equal(s.load(day)?.weekendOverride, true);
      assert.equal(s.hasLlmAttempt(day, "auto"), true);
    } finally {
      s.close();
    }
    const raw2 = new DatabaseSync(join(dir, DAY_PLAN_DB));
    assert.equal((raw2.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 2);
    raw2.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
