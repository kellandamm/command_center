import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";
import {
  baselineForDayIndex,
  burnRateFromHistory,
  dailyBudgetLeft,
  dayIndexInCycle,
  daysLeftUntilReset,
  projectedAtReset,
  resetCountdownParts,
  runOutEstimate,
} from "../src/agents-usage/pace";
import type { UsageSnapshot } from "../src/agents-usage/types";

const ADMIN_TOKEN = "a".repeat(32);
const IMPORT_TOKEN = "u".repeat(32);
const sessionAuthz = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json", "x-ah": "1" };
const importAuthz = { authorization: `Bearer ${IMPORT_TOKEN}`, "content-type": "application/json" };

async function harness(env: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cc-usage-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN,
    AGENTS_USAGE_IMPORT_TOKEN: IMPORT_TOKEN,
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
    auth: makeAuthenticator(cfg),
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
  return { base, close, store: integration.agentsUsage };
}

const samplePayload = {
  asOf: "2026-10-21T04:00:00.000Z",
  weeklyPercentUsed: 42,
  resetsAt: "2026-10-24T09:00:00.000Z",
  byBot: [{ name: "main", share: 60 }],
  byRoutine: [{ name: "daily", share: 40 }],
  byDay: [{ date: "2026-10-20", share: 12 }, { date: "2026-10-21", share: 15 }],
  checkins: [{ bot: "main", date: "2026-10-21", note: "All good" }],
};

test("agents usage import: auth, validation, dedupe, null handling, history order", async () => {
  const h = await harness();
  try {
    const noTokenCfg = await harness({ AGENTS_USAGE_IMPORT_TOKEN: "" });
    try {
      const unset = await fetch(`${noTokenCfg.base}/api/agents/usage/import`, {
        method: "POST",
        headers: importAuthz,
        body: JSON.stringify(samplePayload),
      });
      assert.equal(unset.status, 503);
    } finally {
      await noTokenCfg.close();
    }

    const unauth = await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(samplePayload),
    });
    assert.equal(unauth.status, 401);

    const wrong = await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: { authorization: "Bearer wrong", "content-type": "application/json" },
      body: JSON.stringify(samplePayload),
    });
    assert.equal(wrong.status, 401);

    const created = await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify(samplePayload),
    });
    assert.equal(created.status, 200);
    const createdBody = (await created.json()) as { duplicate?: boolean; asOf?: string };
    assert.equal(createdBody.duplicate, false);
    assert.equal(createdBody.asOf, samplePayload.asOf);

    const dup = await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({ ...samplePayload, weeklyPercentUsed: 44 }),
    });
    assert.equal(dup.status, 200);
    assert.equal(((await dup.json()) as { duplicate: boolean }).duplicate, true);
    assert.equal(h.store.getSnapshot(samplePayload.asOf)?.weeklyPercentUsed, 44);

    const nullReading = await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({
        ...samplePayload,
        asOf: "2026-10-21T05:00:00.000Z",
        weeklyPercentUsed: null,
        checkins: [{ bot: "main", date: "2026-10-21", note: "Failed read" }],
      }),
    });
    assert.equal(nullReading.status, 200);
    assert.equal(h.store.getSnapshot("2026-10-21T05:00:00.000Z")?.weeklyPercentUsed, null);

    const dash = await fetch(`${h.base}/api/agents/usage`, { headers: sessionAuthz });
    assert.equal(dash.status, 200);
    const dashBody = (await dash.json()) as { computed: { weeklyPercentUsed: number | null } };
    assert.equal(dashBody.computed.weeklyPercentUsed, null);

    const history = await fetch(`${h.base}/api/agents/usage/history`, { headers: sessionAuthz });
    const histBody = (await history.json()) as { snapshots: UsageSnapshot[] };
    assert.deepEqual(
      histBody.snapshots.map((s) => s.asOf),
      ["2026-10-21T04:00:00.000Z", "2026-10-21T05:00:00.000Z"],
    );

    const bad = await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({ asOf: "x", weeklyPercentUsed: 1, resetsAt: null, byBot: [], byRoutine: [], byDay: [] }),
    });
    assert.equal(bad.status, 400);
  } finally {
    await h.close();
  }
});

test("agents usage pace math", () => {
  const now = new Date("2026-10-21T12:00:00.000Z");
  const resetsAt = "2026-10-24T09:00:00.000Z";
  const daysLeft = daysLeftUntilReset(now, resetsAt);
  assert.equal(daysLeft, 3);
  assert.equal(dayIndexInCycle(daysLeft), 5);
  assert.ok(Math.abs(baselineForDayIndex(5)! - (100 / 7) * 5) < 0.001);

  const history: UsageSnapshot[] = [
    {
      asOf: "2026-10-19T04:00:00.000Z",
      weeklyPercentUsed: 10,
      resetsAt,
      byBot: [],
      byRoutine: [],
      byDay: [],
      importedAt: "2026-10-19T04:00:00.000Z",
    },
    {
      asOf: "2026-10-21T04:00:00.000Z",
      weeklyPercentUsed: 40,
      resetsAt,
      byBot: [],
      byRoutine: [],
      byDay: [],
      importedAt: "2026-10-21T04:00:00.000Z",
    },
  ];
  const burn = burnRateFromHistory(now, history);
  assert.ok(burn.avgPerDay !== null && burn.avgPerDay > 0);
  assert.equal(projectedAtReset(40, burn.avgPerDay, daysLeft)! > 40, true);
  assert.equal(dailyBudgetLeft(40, daysLeft)! > 0, true);
  assert.equal(resetCountdownParts(now, null), null);
  const rc = resetCountdownParts(now, resetsAt);
  assert.ok(rc && rc.days >= 2);
  const runout = runOutEstimate(90, 20);
  assert.ok(runout.hours !== null || runout.days !== null);
});

test("agents usage checkins upsert per bot and date", async () => {
  const h = await harness();
  try {
    await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({
        ...samplePayload,
        checkins: [{ bot: "main", date: "2026-10-21", note: "first" }],
      }),
    });
    await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({
        ...samplePayload,
        asOf: "2026-10-21T06:00:00.000Z",
        checkins: [{ bot: "main", date: "2026-10-21", note: "second" }],
      }),
    });
    const rows = h.store.listCheckins().filter((c) => c.bot === "main" && c.date === "2026-10-21");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.note, "second");
  } finally {
    await h.close();
  }
});
