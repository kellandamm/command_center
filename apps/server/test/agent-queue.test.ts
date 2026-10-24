import { afterEach, test } from "node:test";
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
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "./cf-access-jwt";
import { setIntegrationCfAccessVerifier } from "../src/mcp/auth";
import { setQueueCfAccessVerifier } from "../src/queue/auth";
import { queueHmacSign, queueSignPayload } from "../src/queue/hmac";
import { ConnectionsStore } from "../src/connections";

const PRODUCER_KEY = "p".repeat(32);
const WORKER_KEY = "w".repeat(32);
const ADMIN = "a".repeat(32);

const queueEnv = {
  QUEUE_HMAC_KEY_PRODUCER: PRODUCER_KEY,
  QUEUE_HMAC_KEY_WORKER: WORKER_KEY,
  CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
  CF_ACCESS_AUD: TEST_CF_AUD,
};

afterEach(() => {
  setIntegrationCfAccessVerifier(undefined);
  setQueueCfAccessVerifier(undefined);
});

async function cfJwt() {
  const keys = await createTestCfAccessJwt();
  setIntegrationCfAccessVerifier(keys.verifier);
  setQueueCfAccessVerifier(keys.verifier);
  const jwt = await keys.signServiceTokenJwt("queue-test-service");
  return { "cf-access-jwt-assertion": jwt };
}

function queueHeaders(key: string, rawBody: string, extra: Record<string, string> = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const sig = queueHmacSign(key, ts, nonce, rawBody);
  return {
    "x-queue-timestamp": ts,
    "x-queue-nonce": nonce,
    "x-queue-signature": sig,
    ...extra,
  };
}

async function harness(env: Record<string, string> = {}, owner = false) {
  const dir = await mkdtemp(join(tmpdir(), "agent-q-"));
  const deployment = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: ADMIN,
    TZ: "UTC",
    ...queueEnv,
    ...env,
  });
  const connections = await ConnectionsStore.open(deployment);
  const cfg = connections.config;
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
    connections,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, close, cfg };
}

/** Shared with homelab-agent/worker/tests/test_hmac.py */
export const HMAC_CROSS_CHECK = {
  key: "k".repeat(32),
  ts: 1_700_000_000,
  nonce: "nonce-abc",
  body: '{"text":"hello"}',
  expected: "b79eb948e0ca666f5e7517d99ea427b3c849a795c302e2a44eb6cf301131cae5",
};

test("HMAC cross-check vector matches documented signing string", () => {
  const { key, ts, nonce, body, expected } = HMAC_CROSS_CHECK;
  assert.equal(queueSignPayload(ts, nonce, body), "1700000000|nonce-abc|{\"text\":\"hello\"}");
  assert.equal(queueHmacSign(key, ts, nonce, body), expected);
});

test("valid producer signature and JWT enqueue; worker cannot create", async () => {
  const h = await harness();
  try {
    const jwt = await cfJwt();
    const raw = JSON.stringify({ text: "check disk" });
    const create = await fetch(`${h.base}/api/queue`, {
      method: "POST",
      headers: { ...jwt, ...queueHeaders(PRODUCER_KEY, raw), "content-type": "application/json" },
      body: raw,
    });
    assert.equal(create.status, 201);
    const { task } = await create.json() as { task: { id: string } };

    const workerCreate = await fetch(`${h.base}/api/queue`, {
      method: "POST",
      headers: { ...jwt, ...queueHeaders(WORKER_KEY, raw), "content-type": "application/json" },
      body: raw,
    });
    assert.equal(workerCreate.status, 403);

    const readRaw = "";
    const read = await fetch(`${h.base}/api/queue/${task.id}`, {
      headers: { ...jwt, ...queueHeaders(PRODUCER_KEY, readRaw) },
    });
    assert.equal(read.status, 200);
  } finally {
    await h.close();
  }
});

test("bad signature, stale timestamp, replayed nonce, missing JWT rejected", async () => {
  const h = await harness();
  try {
    const jwt = await cfJwt();
    const raw = JSON.stringify({ text: "x" });
    const badSig = await fetch(`${h.base}/api/queue`, {
      method: "POST",
      headers: {
        ...jwt,
        "x-queue-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-queue-nonce": crypto.randomUUID(),
        "x-queue-signature": "00".repeat(32),
        "content-type": "application/json",
      },
      body: raw,
    });
    assert.equal(badSig.status, 401);

    const staleTs = String(Math.floor(Date.now() / 1000) - 400);
    const nonce = crypto.randomUUID();
    const stale = await fetch(`${h.base}/api/queue`, {
      method: "POST",
      headers: {
        ...jwt,
        "x-queue-timestamp": staleTs,
        "x-queue-nonce": nonce,
        "x-queue-signature": queueHmacSign(PRODUCER_KEY, staleTs, nonce, raw),
        "content-type": "application/json",
      },
      body: raw,
    });
    assert.equal(stale.status, 401);

    const headers = { ...jwt, ...queueHeaders(PRODUCER_KEY, raw), "content-type": "application/json" };
    const first = await fetch(`${h.base}/api/queue`, { method: "POST", headers, body: raw });
    assert.equal(first.status, 201);
    const replay = await fetch(`${h.base}/api/queue`, { method: "POST", headers, body: raw });
    assert.equal(replay.status, 401);

    const noJwt = await fetch(`${h.base}/api/queue`, {
      method: "POST",
      headers: { ...queueHeaders(PRODUCER_KEY, raw), "content-type": "application/json" },
      body: raw,
    });
    assert.equal(noJwt.status, 403);
  } finally {
    await h.close();
  }
});

test("lease claim, result, proposals and owner approve/deny", async () => {
  const h = await harness({}, true);
  try {
    const jwt = await cfJwt();
    const raw = JSON.stringify({ text: "run health" });
    const created = await (await fetch(`${h.base}/api/queue`, {
      method: "POST",
      headers: { ...jwt, ...queueHeaders(PRODUCER_KEY, raw), "content-type": "application/json" },
      body: raw,
    })).json() as { task: { id: string } };

    const claim = await fetch(`${h.base}/api/queue/next`, {
      headers: { ...jwt, ...queueHeaders(WORKER_KEY, "") },
    });
    assert.equal(claim.status, 200);
    const claimed = await claim.json() as { task: { id: string; status: string } };
    assert.equal(claimed.task?.status, "leased");

    const resultBody = JSON.stringify({ status: "approval_needed", summary: "needs reboot", tokens_used: 42 });
    const result = await fetch(`${h.base}/api/queue/${created.task.id}/result`, {
      method: "POST",
      headers: { ...jwt, ...queueHeaders(WORKER_KEY, resultBody), "content-type": "application/json" },
      body: resultBody,
    });
    assert.equal(result.status, 200);

    const propBody = JSON.stringify({ action_id: "vm.restart", args: { name: "lab" }, reason: "disk full" });
    const prop = await fetch(`${h.base}/api/queue/${created.task.id}/proposals`, {
      method: "POST",
      headers: { ...jwt, ...queueHeaders(WORKER_KEY, propBody), "content-type": "application/json" },
      body: propBody,
    });
    assert.equal(prop.status, 201);
    const { approval } = await prop.json() as { approval: { id: string } };

    const deny = await fetch(`${h.base}/api/approvals/${approval.id}/deny`, {
      method: "POST",
      headers: { "x-ah": "1" },
      body: "{}",
    });
    assert.equal(deny.status, 200);
  } finally {
    await h.close();
  }
});

test("expired proposal cannot be approved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-approvals-"));
  try {
    const { AgentApprovalsStore } = await import("../src/stores/agent-approvals");
    const store = await AgentApprovalsStore.open(dir);
    const row = await store.createProposal({
      taskId: "task-1",
      action_id: "vm.restart",
      args: {},
      reason: "test",
    });
    const path = join(dir, "agent-approvals.json");
    const { readFile, writeFile } = await import("node:fs/promises");
    const rows = JSON.parse(await readFile(path, "utf8")) as Array<{ id: string; expires_at: string }>;
    rows[0]!.expires_at = new Date(Date.now() - 60_000).toISOString();
    await writeFile(path, JSON.stringify(rows));
    const reloaded = await AgentApprovalsStore.open(dir);
    const decided = await reloaded.decide(row.id, "approved");
    assert.equal(decided, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("queue endpoints return 404 when keys unset", async () => {
  const h = await harness({ QUEUE_HMAC_KEY_PRODUCER: "", QUEUE_HMAC_KEY_WORKER: "" });
  try {
    const jwt = await cfJwt();
    const res = await fetch(`${h.base}/api/queue/next`, { headers: { ...jwt, ...queueHeaders(WORKER_KEY, "") } });
    assert.equal(res.status, 404);
  } finally {
    await h.close();
  }
});
