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
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "./cf-access-jwt";
import {
  setAgentsUsageCfAccessVerifierForTests,
} from "../src/agents-usage/auth";
import { parseNormalizeInstant } from "../src/agents-usage/datetime";
import {
  baselineForDayIndex,
  burnRateFromHistory,
  cycleEndedAtReading,
  dailyBudgetLeft,
  dayIndexInCycle,
  daysLeftUntilReset,
  paceStatus,
  projectedAtReset,
  resetAtSameCycle,
  runOutBeforeReset,
  snapshotsInCycle,
} from "../src/agents-usage/pace";
import { buildUsageDashboard } from "../src/agents-usage/view";
import type { UsageSnapshot } from "../src/agents-usage/types";
import { setAgentsUsageWriteForTests } from "../src/agents-usage/store";

const ADMIN_TOKEN = "a".repeat(32);
const IMPORT_TOKEN = "u".repeat(32);
const MCP_TOKEN = "p".repeat(32);
const CF_SERVICE = "cf-usage-test";

const ownerAuthz = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json", "x-ah": "1" };
const anonAuthz = { "content-type": "application/json", "x-ah": "1" };

let cfKeys: Awaited<ReturnType<typeof createTestCfAccessJwt>>;

afterEach(() => {
  setAgentsUsageCfAccessVerifierForTests(undefined);
  setAgentsUsageWriteForTests(null);
});

async function importHeaders(bearer = IMPORT_TOKEN) {
  const jwt = await cfKeys.signServiceTokenJwt(CF_SERVICE);
  return {
    authorization: `Bearer ${bearer}`,
    "cf-access-jwt-assertion": jwt,
    "content-type": "application/json",
  };
}

async function harness(env: Record<string, string> = {}) {
  cfKeys = await createTestCfAccessJwt();
  setAgentsUsageCfAccessVerifierForTests(cfKeys.verifier);
  const dir = await mkdtemp(join(tmpdir(), "cc-usage-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN,
    AGENTS_USAGE_IMPORT_TOKEN: IMPORT_TOKEN,
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: TEST_CF_AUD,
    OWNER_EMAILS: "owner@example.com",
    ...env,
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async (jwt) => ({ email: jwt === "owner" ? "owner@example.com" : "reader@example.com" })),
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
  return { base, close, store: integration.agentsUsage, cfg: dir };
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

test("agents usage import requires JWT and bearer together", async () => {
  const h = await harness();
  try {
    const noToken = await harness({ AGENTS_USAGE_IMPORT_TOKEN: "" });
    try {
      const res = await fetch(`${noToken.base}/api/agents/usage/import`, {
        method: "POST",
        headers: await importHeaders(),
        body: JSON.stringify(samplePayload),
      });
      assert.equal(res.status, 503);
    } finally {
      await noToken.close();
    }

    const hdr = await importHeaders();
    const { authorization: _omit, ...jwtOnlyHeaders } = hdr;
    const jwtOnly = await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: jwtOnlyHeaders,
      body: JSON.stringify(samplePayload),
    });
    assert.equal(jwtOnly.status, 401);

    const bearerOnly = await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: { authorization: `Bearer ${IMPORT_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(samplePayload),
    });
    assert.equal(bearerOnly.status, 401);

    const mcpBearer = await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${MCP_TOKEN}`,
        "cf-access-jwt-assertion": await cfKeys.signServiceTokenJwt(CF_SERVICE),
        "content-type": "application/json",
      },
      body: JSON.stringify(samplePayload),
    });
    assert.equal(mcpBearer.status, 401);

    const ok = await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: await importHeaders(),
      body: JSON.stringify(samplePayload),
    });
    assert.equal(ok.status, 200);
  } finally {
    await h.close();
  }
});

test("agents usage normalizes asOf and dedupes equivalent instants", async () => {
  const h = await harness();
  try {
    const headers = await importHeaders();
    const first = await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...samplePayload, asOf: "2026-10-21T04:00:00Z" }),
    });
    assert.equal(first.status, 200);
    const second = await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...samplePayload, asOf: "2026-10-21T04:00:00.000Z", weeklyPercentUsed: 43 }),
    });
    assert.equal(second.status, 200);
    assert.equal(((await second.json()) as { duplicate: boolean }).duplicate, true);
    assert.equal(h.store.listSnapshots().length, 1);
    assert.equal(h.store.getSnapshot("2026-10-21T04:00:00.000Z")?.weeklyPercentUsed, 43);
    assert.equal(parseNormalizeInstant("2026-10-21T04:00:00Z", "asOf"), "2026-10-21T04:00:00.000Z");
  } finally {
    await h.close();
  }
});

test("agents usage rejects invalid datetimes, duplicate byDay, and blank notes", async () => {
  const h = await harness();
  try {
    const headers = await importHeaders();
    const badOffset = await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...samplePayload, asOf: "2026-10-21T04:00:00" }),
    });
    assert.equal(badOffset.status, 400);

    const dupDay = await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...samplePayload,
        byDay: [
          { date: "2026-10-20", share: 1 },
          { date: "2026-10-20", share: 2 },
        ],
      }),
    });
    assert.equal(dupDay.status, 400);

    const blankNote = await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...samplePayload, checkins: [{ bot: "x", date: "2026-10-21", note: "   " }] }),
    });
    assert.equal(blankNote.status, 400);
  } finally {
    await h.close();
  }
});

test("agents usage GET routes are owner-only", async () => {
  const h = await harness();
  try {
    await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: await importHeaders(),
      body: JSON.stringify(samplePayload),
    });
    const denied = await fetch(`${h.base}/api/agents/usage`, {
      headers: { ...ownerAuthz, cookie: "CF_Authorization=reader" },
    });
    assert.equal(denied.status, 403);
    const ok = await fetch(`${h.base}/api/agents/usage`, {
      headers: { ...ownerAuthz, cookie: "CF_Authorization=owner" },
    });
    assert.equal(ok.status, 200);
  } finally {
    await h.close();
  }
});

test("agents usage never-fake: null resetsAt and cycle ended", async () => {
  const h = await harness();
  try {
    await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: await importHeaders(),
      body: JSON.stringify({
        ...samplePayload,
        resetsAt: null,
        asOf: "2026-10-21T08:00:00.000Z",
      }),
    });
    const dash = buildUsageDashboard(h.store);
    assert.equal(dash.computed.metricsUnavailable, true);
    assert.equal(dash.computed.burnRatePerDay, null);

    await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: await importHeaders(),
      body: JSON.stringify({
        ...samplePayload,
        asOf: "2026-10-25T08:00:00.000Z",
        weeklyPercentUsed: 10,
        resetsAt: "2026-10-24T09:00:00.000Z",
      }),
    });
    const ended = buildUsageDashboard(h.store);
    assert.equal(ended.computed.cycleEnded, true);
    assert.equal(ended.computed.dayIndex, null);
    assert.equal(ended.computed.burnRatePerDay, null);
  } finally {
    await h.close();
  }
});

test("agents usage bar slots mark missing byDay as noData", async () => {
  const h = await harness();
  try {
    await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: await importHeaders(),
      body: JSON.stringify({
        ...samplePayload,
        byDay: [{ date: "2026-10-21", share: 15 }],
      }),
    });
    const dash = buildUsageDashboard(h.store);
    assert.ok(dash.chart.dailyIncrements.some((row) => row.noData));
    assert.ok(dash.chart.dailyIncrements.some((row) => !row.noData && row.value === 15));
  } finally {
    await h.close();
  }
});

test("agents usage pace math: jitter, burn floor, run-out before reset, behind pace", () => {
  const readingAt = new Date("2026-10-21T12:00:00.000Z");
  const resetsAt = "2026-10-24T09:00:00.000Z";
  assert.equal(daysLeftUntilReset(readingAt, resetsAt), 3);
  assert.equal(dayIndexInCycle(3, false), 5);
  assert.equal(paceStatus(30, baselineForDayIndex(5)), "behind");
  assert.ok(resetAtSameCycle("2026-10-24T09:00:00.000Z", "2026-10-24T09:02:00.000Z"));

  const history: UsageSnapshot[] = [
    {
      asOf: "2026-10-21T10:00:00.000Z",
      weeklyPercentUsed: 10,
      resetsAt,
      byBot: [],
      byRoutine: [],
      byDay: [],
      importedAt: "2026-10-21T10:00:00.000Z",
    },
    {
      asOf: "2026-10-21T12:00:00.000Z",
      weeklyPercentUsed: 20,
      resetsAt: "2026-10-24T09:01:00.000Z",
      byBot: [],
      byRoutine: [],
      byDay: [],
      importedAt: "2026-10-21T12:00:00.000Z",
    },
  ];
  assert.equal(snapshotsInCycle(history, history[1]).length, 2);
  const burn = burnRateFromHistory(history);
  assert.ok(burn.avgPerDay !== null && burn.avgPerDay > 20);
  assert.equal(burn.lowConfidence, true);

  const runOut = runOutBeforeReset(95, 40, readingAt, resetsAt);
  assert.ok(runOut && (runOut.hours !== null || (runOut.days !== null && runOut.days < 1)));
  assert.equal(dailyBudgetLeft(110, 2), 0);
  assert.equal(projectedAtReset(40, burn.avgPerDay, 3)! > 40, true);
  assert.equal(cycleEndedAtReading(new Date("2026-10-24T10:00:00.000Z"), resetsAt), true);
});

test("agents usage store rolls back memory when disk write fails", async () => {
  const h = await harness();
  try {
    await fetch(`${h.base}/api/agents/usage/import`, {
      method: "POST",
      headers: await importHeaders(),
      body: JSON.stringify(samplePayload),
    });
    setAgentsUsageWriteForTests(async () => {
      throw new Error("disk full");
    });
    try {
      await assert.rejects(
        () =>
          h.store.importPayload({
            ...samplePayload,
            asOf: "2026-10-22T04:00:00.000Z",
            weeklyPercentUsed: 50,
          }),
        /disk full/,
      );
    } finally {
      setAgentsUsageWriteForTests(null);
    }
    assert.equal(h.store.listSnapshots().length, 1);
    assert.equal(h.store.getSnapshot("2026-10-21T04:00:00.000Z")?.weeklyPercentUsed, 42);
  } finally {
    await h.close();
  }
});

test("agents usage invalid asOf in view does not fall back to now", () => {
  const store = {
    latestSnapshot: () => ({
      asOf: "not-a-date",
      weeklyPercentUsed: 40,
      resetsAt: "2026-10-24T09:00:00.000Z",
      byBot: [],
      byRoutine: [],
      byDay: [],
      importedAt: "2026-10-21T04:00:00.000Z",
    }),
    listSnapshots: () => [],
    listCheckins: () => [],
    dailyLog: () => [],
  };
  const dash = buildUsageDashboard(store as never);
  assert.equal(dash.computed.metricsUnavailable, true);
  assert.equal(dash.computed.weeklyPercentUsed, null);
});
