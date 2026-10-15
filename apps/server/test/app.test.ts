import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { BriefingService } from "../src/briefing/service";
import { AiSecurityService } from "../src/ai-security/service";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig, assertAuthConfigured, llmConfigured } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { NewsPrefsStore } from "../src/feeds/news-prefs";
import { FeedsStore } from "../src/feeds/store";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { openIntegrationStores } from "./helpers";
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "./cf-access-jwt";
import { setIntegrationCfAccessVerifier } from "../src/mcp/auth";

const TOKEN = "t".repeat(32);
const MCP_TOKEN = "m".repeat(32);
const CF_SERVICE_CLIENT_ID = "cf-service-copilot-test-id";
const mcpIntegrationEnv = {
  MCP_APP_TOKENS: JSON.stringify({ copilot: MCP_TOKEN }),
  MCP_CF_CLIENT_MAP: JSON.stringify({ copilot: CF_SERVICE_CLIENT_ID }),
  CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
  CF_ACCESS_AUD: TEST_CF_AUD,
};

afterEach(() => setIntegrationCfAccessVerifier(undefined));

async function accessJwtHeaders(commonName = CF_SERVICE_CLIENT_ID) {
  const keys = await createTestCfAccessJwt();
  setIntegrationCfAccessVerifier(keys.verifier);
  const jwt = await keys.signServiceTokenJwt(commonName);
  return { "cf-access-jwt-assertion": jwt };
}

async function harness(env: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cc-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    TZ: "UTC",
    LLM_BASE_URL: "https://api.example/v1",
    LLM_API_KEY: "sk-test",
    LLM_MODEL: "test-model",
    ...env,
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const feeds = await FeedsStore.open(dir);
  const newsPrefs = await NewsPrefsStore.open(dir);
  const briefing = await BriefingService.open(dir, cfg.tz);
  const aiSecurity = await AiSecurityService.open(dir);
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg),
    settings,
    feeds,
    briefing,
    aiSecurity,
    dailyBriefing,
    newsPrefs,
    notes,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
  };
  return { base, settings, feeds, briefing, close, cfg };
}
const authz = { authorization: `Bearer ${TOKEN}` };

test("config: invalid MCP_CF_CLIENT_MAP JSON refuses startup", () => {
  assert.throws(() => loadConfig({ ADMIN_TOKEN: TOKEN, MCP_CF_CLIENT_MAP: "not-json" }), /Invalid JSON/);
});

test("config: refuses to start without any authentication", () => {
  assert.throws(() => assertAuthConfigured(loadConfig({})), /No authentication/);
  assert.throws(() => loadConfig({ CF_ACCESS_TEAM_DOMAIN: "x.cloudflareaccess.com" }), /both/i);
  assert.throws(() => loadConfig({ ADMIN_TOKEN: "short" }), /24/);
  assertAuthConfigured(loadConfig({ ALLOW_INSECURE_NO_AUTH: "1" }));
});

test("config: llm is optional", () => {
  const cfg = loadConfig({ ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "1" });
  assert.equal(llmConfigured(cfg), false);
});

test("http: healthz is open; everything else needs auth; CSRF header is required for writes", async () => {
  const h = await harness();
  try {
    assert.equal((await fetch(`${h.base}/healthz`)).status, 200);
    assert.equal((await fetch(`${h.base}/`)).status, 401);
    assert.equal((await fetch(`${h.base}/api/state`, { headers: authz })).status, 200);
    assert.equal((await fetch(`${h.base}/api/settings`, { method: "PUT", headers: authz })).status, 403);
    assert.equal(
      (await fetch(`${h.base}/api/settings`, { method: "PUT", headers: { ...authz, "x-ah": "1", origin: "https://evil.example", "content-type": "application/json" }, body: "{}" })).status,
      403,
    );
    const r = await fetch(`${h.base}/?token=${TOKEN}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("set-cookie")!, /HttpOnly/);
  } finally {
    await h.close();
  }
});

test("http: Cloudflare Access JWT is verified; a bad one is refused", async () => {
  const cfg = loadConfig({ DATA_DIR: "/tmp/x", CF_ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", CF_ACCESS_AUD: "aud" });
  const auth = makeAuthenticator(cfg, async (tok) => {
    if (tok === "good") return "me@example.com";
    throw new Error("bad");
  });
  const mk = (h: Record<string, string>) => ({ headers: h }) as any;
  const url = new URL("http://x/");
  assert.deepEqual(await auth(mk({ "cf-access-jwt-assertion": "good" }), url), { ok: true, who: "me@example.com" });
  assert.equal((await auth(mk({ "cf-access-jwt-assertion": "bad" }), url)).ok, false);
});

test("settings API validates schedule and feed scope", async () => {
  const h = await harness();
  try {
    const put = (body: unknown) =>
      fetch(`${h.base}/api/settings`, {
        method: "PUT",
        headers: { ...authz, "x-ah": "1", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const ok = await put({ fetchIntervalMinutes: 20, feedScope: { mode: "all", folderIds: [] } });
    assert.equal(ok.status, 200);
    const j: any = await ok.json();
    assert.equal(typeof j.feedCount, "number");
    assert.equal(h.settings.get().fetchIntervalMinutes, 20);
    assert.equal((await put({ briefingTime: "99:99" })).status, 400);
  } finally {
    await h.close();
  }
});

test("http: full pages render with sidebar nav", async () => {
  const h = await harness();
  try {
    for (const path of ["/board", "/wins", "/notes", "/calendar", "/activity", "/settings"]) {
      const r = await fetch(`${h.base}${path}`, { headers: authz });
      assert.equal(r.status, 200, path);
      const html = await r.text();
      assert.match(html, /sidebar-nav/);
    }
  } finally {
    await h.close();
  }
});

test("calendar API without ICS_URLS is disabled", async () => {
  const h = await harness();
  try {
    const r = await fetch(`${h.base}/api/calendar`, { headers: authz });
    assert.equal(r.status, 200);
    const j: any = await r.json();
    assert.equal(j.configured, false);
    assert.deepEqual(j.events, []);
  } finally {
    await h.close();
  }
});

test("notes API round-trip", async () => {
  const h = await harness();
  try {
    const get = await fetch(`${h.base}/api/notes`, { headers: authz });
    assert.equal((await get.json()).content, "");
    const put = await fetch(`${h.base}/api/notes`, {
      method: "PUT",
      headers: { ...authz, "x-ah": "1", "content-type": "application/json" },
      body: JSON.stringify({ content: "line one" }),
    });
    assert.equal(put.status, 200);
    const again = await fetch(`${h.base}/api/notes`, { headers: authz });
    assert.equal((await again.json()).content, "line one");
  } finally {
    await h.close();
  }
});

test("mcp: rejects when MCP_CF_CLIENT_MAP is missing (fail closed)", async () => {
  const h = await harness({
    MCP_APP_TOKENS: JSON.stringify({ copilot: MCP_TOKEN }),
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: TEST_CF_AUD,
  });
  try {
    const r = await fetch(`${h.base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${MCP_TOKEN}`, ...(await accessJwtHeaders()) },
      body: "{}",
    });
    assert.equal(r.status, 403);
    const j: any = await r.json();
    assert.match(j.error, /MCP_CF_CLIENT_MAP/);
  } finally {
    await h.close();
  }
});

test("integrations: unknown service token in JWT common_name is rejected", async () => {
  const secret = "w".repeat(32);
  const h = await harness({ ...mcpIntegrationEnv, WEBHOOK_SECRET: secret });
  try {
    const jwtHdr = await accessJwtHeaders("not-registered-service-id");
    const mcp = await fetch(`${h.base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${MCP_TOKEN}`, ...jwtHdr, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(mcp.status, 403);
    const wh = await fetch(`${h.base}/api/webhooks/power-automate`, {
      method: "POST",
      headers: { "x-webhook-secret": secret, ...jwtHdr, "content-type": "application/json" },
      body: JSON.stringify({ action: "notes_read" }),
    });
    assert.equal(wh.status, 403);
  } finally {
    await h.close();
  }
});

test("integrations: CF-Access-Client-Id header alone cannot bypass JWT checks", async () => {
  const h = await harness(mcpIntegrationEnv);
  try {
    const r = await fetch(`${h.base}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${MCP_TOKEN}`,
        "cf-access-client-id": CF_SERVICE_CLIENT_ID,
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(r.status, 403);
    const j: any = await r.json();
    assert.match(j.error, /Jwt-Assertion/i);
  } finally {
    await h.close();
  }
});

test("integrations: expired Access JWT is rejected", async () => {
  const h = await harness(mcpIntegrationEnv);
  try {
    const keys = await createTestCfAccessJwt();
    setIntegrationCfAccessVerifier(keys.verifier);
    const jwt = await keys.signServiceTokenJwt(CF_SERVICE_CLIENT_ID, { expiresAt: Math.floor(Date.now() / 1000) - 120 });
    const r = await fetch(`${h.base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${MCP_TOKEN}`, "cf-access-jwt-assertion": jwt },
      body: "{}",
    });
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /Invalid or expired/i);
  } finally {
    await h.close();
  }
});

test("webhook: rejects webhook secret without CF service token when map unset", async () => {
  const secret = "w".repeat(32);
  const h = await harness({ WEBHOOK_SECRET: secret });
  try {
    const wh = await fetch(`${h.base}/api/webhooks/power-automate`, {
      method: "POST",
      headers: { "x-webhook-secret": secret, "content-type": "application/json" },
      body: JSON.stringify({ action: "notes_read" }),
    });
    assert.equal(wh.status, 403);
  } finally {
    await h.close();
  }
});

test("mcp: rejects bearer without Cf-Access-Jwt-Assertion", async () => {
  const h = await harness(mcpIntegrationEnv);
  try {
    assert.equal(
      (await fetch(`${h.base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${MCP_TOKEN}` }, body: "{}" })).status,
      403,
    );
  } finally {
    await h.close();
  }
});

test("webhook and hobie queue persist under data dir", async () => {
  const secret = "w".repeat(32);
  const h = await harness({ ...mcpIntegrationEnv, WEBHOOK_SECRET: secret });
  try {
    const jwtHdr = await accessJwtHeaders();
    const wh = await fetch(`${h.base}/api/webhooks/power-automate`, {
      method: "POST",
      headers: { "x-webhook-secret": secret, ...jwtHdr, "content-type": "application/json" },
      body: JSON.stringify({ action: "hobie_queue_task", title: "Ship it", body: "Please review", urgent: true }),
    });
    assert.equal(wh.status, 200);
    const q = await fetch(`${h.base}/api/hobie/queue`, { headers: authz });
    const jq: any = await q.json();
    assert.equal(jq.tasks.length, 1);
    assert.equal(jq.tasks[0].title, "Ship it");
    assert.equal(jq.tasks[0].urgent, true);

    const claim = await fetch(`${h.base}/api/hobie/claim`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ id: jq.tasks[0].id }),
    });
    assert.equal(claim.status, 200);

    const act = await fetch(`${h.base}/api/webhooks/power-automate`, {
      method: "POST",
      headers: { "x-webhook-secret": secret, ...jwtHdr, "content-type": "application/json" },
      body: JSON.stringify({ action: "panel_post_update", panel: "activity", markdown: "Copilot checked in" }),
    });
    assert.equal(act.status, 200);
    const updates = await fetch(`${h.base}/api/activity/updates`, { headers: authz });
    const uj: any = await updates.json();
    assert.equal(uj.updates[0].markdown, "Copilot checked in");
  } finally {
    await h.close();
  }
});

test("mcp: notes_append round-trip via SDK client", async () => {
  const h = await harness(mcpIntegrationEnv);
  try {
    const jwtHdr = await accessJwtHeaders();
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const transport = new StreamableHTTPClientTransport(new URL(`${h.base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN}`, ...jwtHdr } },
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    await client.callTool({ name: "notes_append", arguments: { text: "hello from mcp" } });
    const notes = await fetch(`${h.base}/api/notes`, { headers: authz });
    const nj: any = await notes.json();
    assert.match(nj.content, /hello from mcp/);
    await client.close();
  } finally {
    await h.close();
  }
});

test("daily briefing API lists days and returns null before first run", async () => {
  const h = await harness();
  try {
    const days = await fetch(`${h.base}/api/daily-briefing/days`, { headers: authz });
    assert.equal(days.status, 200);
    assert.deepEqual((await days.json()).days, []);
    const today = await fetch(`${h.base}/api/daily-briefing`, { headers: authz });
    assert.equal(today.status, 200);
    const j: any = await today.json();
    assert.equal(j.briefing, null);
    assert.match(j.day, /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    await h.close();
  }
});

test("briefing generate without LLM returns graceful error", async () => {
  const h = await harness({ LLM_API_KEY: "", LLM_BASE_URL: "", LLM_MODEL: "" });
  try {
    const r = await fetch(`${h.base}/api/briefing/generate`, { method: "POST", headers: { ...authz, "x-ah": "1" } });
    assert.equal(r.status, 200);
    const j: any = await r.json();
    assert.match(j.briefing.error, /LLM not configured/);
  } finally {
    await h.close();
  }
});
