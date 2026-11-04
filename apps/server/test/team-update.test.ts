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
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM, TEST_CF_TEAM_UPDATE_AUD } from "./cf-access-jwt";
import { setAgentsUsageCfAccessVerifierForTests } from "../src/agents-usage/auth";
import { OWNER_ACTION_FORBIDDEN } from "../src/owner-auth";
import { SERVICE_WORKER } from "../src/pwa";
import { serviceWorkerBypassesFetch } from "../src/pwa-fetch-guard";
import { dayKey } from "../src/store";
import {
  retainTeamUpdateDaysForTests,
  setTeamUpdateWriteForTests,
  teamUpdateRetentionCutoffDate,
} from "../src/briefing/team-update/store";
import { TEAM_UPDATE_IMPORT_MAX_BYTES, TEAM_UPDATE_RETAIN_DAYS } from "../src/briefing/team-update/constants";
import { dailyBriefingPage } from "../src/ui/daily-briefing-page";

const ADMIN_TOKEN = "a".repeat(32);
const IMPORT_TOKEN = "t".repeat(32);
const USAGE_IMPORT_TOKEN = "u".repeat(32);
const CF_SERVICE = "cf-team-update-test";

const ownerAuthz = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json", "x-ah": "1" };
const ownerCookie = { ...ownerAuthz, cookie: "CF_Authorization=owner" };

let cfKeys: Awaited<ReturnType<typeof createTestCfAccessJwt>>;

afterEach(() => {
  setAgentsUsageCfAccessVerifierForTests(undefined);
  setTeamUpdateWriteForTests(null);
});

async function importHeaders(bearer = IMPORT_TOKEN) {
  const jwt = await cfKeys.signServiceTokenJwt(CF_SERVICE);
  return {
    authorization: `Bearer ${bearer}`,
    "cf-access-jwt-assertion": jwt,
    "content-type": "application/json",
  };
}

function samplePayload(date: string) {
  return {
    date,
    agents: [
      {
        name: "Stremmy",
        did: ["Shipped team update tab"],
        waitingOnKellan: ["Review PR"],
        updatedAt: "2026-11-04T18:00:00.000Z",
      },
    ],
  };
}

async function harness(env: Record<string, string> = {}) {
  const audList = (env.CF_ACCESS_AUD ?? TEST_CF_AUD).split(",").map((s) => s.trim()).filter(Boolean);
  cfKeys = await createTestCfAccessJwt(audList.length === 1 ? audList[0]! : audList);
  setAgentsUsageCfAccessVerifierForTests(cfKeys.verifier);
  const dir = await mkdtemp(join(tmpdir(), "cc-team-update-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN,
    TEAM_UPDATE_IMPORT_TOKEN: IMPORT_TOKEN,
    AGENTS_USAGE_IMPORT_TOKEN: USAGE_IMPORT_TOKEN,
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: audList.join(","),
    OWNER_EMAILS: "owner@example.com",
    TZ: env.TZ ?? "UTC",
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
  return { base, close, store: integration.teamUpdate, cfg };
}

test("team update import auth matrix", async () => {
  const h = await harness();
  try {
    const unconfigured = await harness({ TEAM_UPDATE_IMPORT_TOKEN: "" });
    try {
      const res = await fetch(`${unconfigured.base}/api/team-update/import`, {
        method: "POST",
        headers: await importHeaders(),
        body: JSON.stringify(samplePayload("2026-11-04")),
      });
      assert.equal(res.status, 503);
    } finally {
      await unconfigured.close();
    }

    const hdr = await importHeaders();
    const { authorization: _omit, ...jwtOnly } = hdr;
    assert.equal(
      (await fetch(`${h.base}/api/team-update/import`, { method: "POST", headers: jwtOnly, body: JSON.stringify(samplePayload("2026-11-04")) })).status,
      401,
    );

    assert.equal(
      (await fetch(`${h.base}/api/team-update/import`, {
        method: "POST",
        headers: { authorization: `Bearer ${IMPORT_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify(samplePayload("2026-11-04")),
      })).status,
      401,
    );

    const emailJwt = await cfKeys.signEmailJwt("human@example.com");
    assert.equal(
      (await fetch(`${h.base}/api/team-update/import`, {
        method: "POST",
        headers: { authorization: `Bearer ${IMPORT_TOKEN}`, "cf-access-jwt-assertion": emailJwt, "content-type": "application/json" },
        body: JSON.stringify(samplePayload("2026-11-04")),
      })).status,
      401,
    );

    assert.equal(
      (await fetch(`${h.base}/api/team-update/import`, {
        method: "POST",
        headers: await importHeaders(ADMIN_TOKEN),
        body: JSON.stringify(samplePayload("2026-11-04")),
      })).status,
      401,
    );

    assert.equal(
      (await fetch(`${h.base}/api/team-update/import`, {
        method: "POST",
        headers: await importHeaders(USAGE_IMPORT_TOKEN),
        body: JSON.stringify(samplePayload("2026-11-04")),
      })).status,
      401,
    );

    const ok = await fetch(`${h.base}/api/team-update/import`, {
      method: "POST",
      headers: await importHeaders(),
      body: JSON.stringify(samplePayload("2026-11-04")),
    });
    assert.equal(ok.status, 200);
  } finally {
    await h.close();
  }
});

test("team update import client id allow-list", async () => {
  const h = await harness({ TEAM_UPDATE_IMPORT_CLIENT_IDS: "other-client" });
  try {
    const res = await fetch(`${h.base}/api/team-update/import`, {
      method: "POST",
      headers: await importHeaders(),
      body: JSON.stringify(samplePayload("2026-11-04")),
    });
    assert.equal(res.status, 401);
  } finally {
    await h.close();
  }
});

test("team update schema rejects unknown keys and caps", async () => {
  const h = await harness();
  try {
    const headers = await importHeaders();
    const unknown = await fetch(`${h.base}/api/team-update/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...samplePayload("2026-11-04"), extra: true }),
    });
    assert.equal(unknown.status, 400);

    const longName = "x".repeat(81);
    const badName = await fetch(`${h.base}/api/team-update/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        date: "2026-11-04",
        agents: [{ name: longName, did: [], waitingOnKellan: [], updatedAt: "2026-11-04T12:00:00.000Z" }],
      }),
    });
    assert.equal(badName.status, 400);

    const longLine = "z".repeat(501);
    const badLine = await fetch(`${h.base}/api/team-update/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        date: "2026-11-04",
        agents: [{ name: "a", did: [longLine], waitingOnKellan: [], updatedAt: "2026-11-04T12:00:00.000Z" }],
      }),
    });
    assert.equal(badLine.status, 400);

    const manyAgents = Array.from({ length: 33 }, (_, i) => ({
      name: `bot-${i}`,
      did: [],
      waitingOnKellan: [],
      updatedAt: "2026-11-04T12:00:00.000Z",
    }));
    const tooMany = await fetch(`${h.base}/api/team-update/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({ date: "2026-11-04", agents: manyAgents }),
    });
    assert.equal(tooMany.status, 400);
  } finally {
    await h.close();
  }
});

test("team update import rejects forbidden budget subscription vault keys", async () => {
  const h = await harness();
  try {
    const headers = await importHeaders();
    for (const key of ["budget", "subscription", "vault"]) {
      const res = await fetch(`${h.base}/api/team-update/import`, {
        method: "POST",
        headers,
        body: JSON.stringify({ date: "2026-11-04", agents: [], [key]: "nope" }),
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: string };
      assert.match(body.error, /forbidden payload key/);
    }
  } finally {
    await h.close();
  }
});

test("team update import returns 413 above 64 KB", async () => {
  const h = await harness();
  try {
    const headers = await importHeaders();
    const pad = "a".repeat(TEAM_UPDATE_IMPORT_MAX_BYTES);
    const res = await fetch(`${h.base}/api/team-update/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({ date: "2026-11-04", agents: [], note: pad }),
    });
    assert.equal(res.status, 413);
  } finally {
    await h.close();
  }
});

test("team update store replaces same day and retains ~30 days", async () => {
  const h = await harness({ TZ: "America/Chicago" });
  try {
    const headers = await importHeaders();
    const day = dayKey(new Date("2026-11-04T15:00:00.000Z"), h.cfg.tz);
    assert.equal(
      (await fetch(`${h.base}/api/team-update/import`, { method: "POST", headers, body: JSON.stringify(samplePayload(day)) })).status,
      200,
    );
    const replaced = await fetch(`${h.base}/api/team-update/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        date: day,
        agents: [{ name: "Other", did: ["Second post"], waitingOnKellan: [], updatedAt: "2026-11-04T20:00:00.000Z" }],
      }),
    });
    assert.equal(replaced.status, 200);
    assert.equal(((await replaced.json()) as { replaced: boolean }).replaced, true);
    assert.equal(h.store.getDay(day)?.agents[0]?.name, "Other");

    const cutoff = teamUpdateRetentionCutoffDate(new Date("2026-11-04T12:00:00.000Z"));
    const kept = retainTeamUpdateDaysForTests([
      { date: cutoff, agents: [], importedAt: "2026-01-01T00:00:00.000Z" },
      { date: "1999-01-01", agents: [], importedAt: "1999-01-01T00:00:00.000Z" },
    ]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.date, cutoff);
    assert.equal(TEAM_UPDATE_RETAIN_DAYS, 30);
  } finally {
    await h.close();
  }
});

test("team update GET is owner-only with no-store", async () => {
  const h = await harness();
  try {
    await fetch(`${h.base}/api/team-update/import`, {
      method: "POST",
      headers: await importHeaders(),
      body: JSON.stringify(samplePayload("2026-11-04")),
    });
    const reader = await fetch(`${h.base}/api/team-update`, {
      headers: { ...ownerAuthz, cookie: "CF_Authorization=reader" },
    });
    assert.equal(reader.status, 403);
    assert.equal(((await reader.json()) as { error: string }).error, OWNER_ACTION_FORBIDDEN);

    const admin = await fetch(`${h.base}/api/team-update`, { headers: ownerAuthz });
    assert.equal(admin.status, 403);

    const ok = await fetch(`${h.base}/api/team-update?day=2026-11-04`, { headers: ownerCookie });
    assert.equal(ok.status, 200);
    assert.match(String(ok.headers.get("cache-control")), /no-store/);
    const body = (await ok.json()) as { update: { agents: { name: string }[] } | null };
    assert.equal(body.update?.agents[0]?.name, "Stremmy");
  } finally {
    await h.close();
  }
});

test("team update import does not log payload content", async () => {
  const h = await harness();
  const secret = "ULTRA_SECRET_TEAM_UPDATE_LINE_QWERTY";
  const logs: string[] = [];
  const original = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.info = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    const res = await fetch(`${h.base}/api/team-update/import`, {
      method: "POST",
      headers: await importHeaders(),
      body: JSON.stringify({
        date: "2026-11-04",
        agents: [{ name: "Secret Agent", did: [secret], waitingOnKellan: ["Review PR"], updatedAt: "2026-11-04T12:00:00.000Z" }],
      }),
    });
    assert.equal(res.status, 200);
    for (const line of logs) {
      assert.doesNotMatch(line, new RegExp(secret));
      assert.doesNotMatch(line, /Secret Agent/);
    }
  } finally {
    console.log = original.log;
    console.error = original.error;
    console.warn = original.warn;
    console.info = original.info;
    await h.close();
  }
});

test("team update PWA fetch guard bypasses API route", () => {
  assert.equal(serviceWorkerBypassesFetch("GET", "/api/team-update"), true);
  assert.ok(SERVICE_WORKER.includes("/api/"));
});

test("daily briefing page includes Team update tab", () => {
  const html = dailyBriefingPage();
  assert.match(html, /id="db-mode-team-update"/);
  assert.match(html, /Team update/);
  assert.match(html, /\/api\/team-update/);
});

test("team update retention cutoff uses UTC calendar days (TZ-independent)", () => {
  const anchor = new Date("2026-06-15T12:00:00.000Z");
  assert.equal(teamUpdateRetentionCutoffDate(anchor), "2026-05-16");
});

test("team update import AUD in CF_ACCESS_AUD does not widen owner or usage import", async () => {
  const h = await harness({
    CF_ACCESS_AUD: `${TEST_CF_AUD},${TEST_CF_TEAM_UPDATE_AUD}`,
    AGENTS_USAGE_IMPORT_TOKEN: USAGE_IMPORT_TOKEN,
  });
  try {
    const teamUpdateAudJwt = await cfKeys.signServiceTokenJwt(CF_SERVICE, { audience: TEST_CF_TEAM_UPDATE_AUD });
    const importHeadersAud = {
      authorization: `Bearer ${IMPORT_TOKEN}`,
      "cf-access-jwt-assertion": teamUpdateAudJwt,
      "content-type": "application/json",
    };
    assert.equal(
      (await fetch(`${h.base}/api/team-update/import`, {
        method: "POST",
        headers: importHeadersAud,
        body: JSON.stringify(samplePayload("2026-11-04")),
      })).status,
      200,
    );
    assert.equal(
      (await fetch(`${h.base}/api/team-update/import`, {
        method: "POST",
        headers: { ...importHeadersAud, authorization: "Bearer wrong-token-only" },
        body: JSON.stringify(samplePayload("2026-11-05")),
      })).status,
      401,
    );
    assert.equal(
      (await fetch(`${h.base}/api/agents/usage/import`, {
        method: "POST",
        headers: importHeadersAud,
        body: JSON.stringify({
          asOf: "2026-10-21T04:00:00.000Z",
          weeklyPercentUsed: 1,
          resetsAt: null,
          byBot: [],
          byRoutine: [],
          byDay: [],
        }),
      })).status,
      401,
    );
    assert.equal(
      (await fetch(`${h.base}/api/team-update`, {
        headers: {
          authorization: `Bearer ${IMPORT_TOKEN}`,
          "cf-access-jwt-assertion": teamUpdateAudJwt,
          "x-ah": "1",
        },
      })).status,
      403,
    );
  } finally {
    await h.close();
  }
});
