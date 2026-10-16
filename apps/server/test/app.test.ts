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

test("knowledge APIs support notes, spaces, captured sources, graph, import, and export", async () => {
  const h = await harness();
  try {
    const write = (path: string, body: unknown, method = "POST") =>
      fetch(`${h.base}${path}`, {
        method,
        headers: { ...authz, "x-ah": "1", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const spaceResponse = await write("/api/knowledge/spaces", {
      name: "Research",
      description: "Project notes",
      instructions: "Be concise.",
    });
    assert.equal(spaceResponse.status, 201);
    const { space } = await spaceResponse.json();
    const cardResponse = await write("/api/board/cards", { title: "Project task", notes: "Track this task." });
    const { card } = await cardResponse.json();
    const referenceResponse = await write("/api/knowledge/space-references", {
      spaceId: space.id,
      type: "board",
      targetId: card.id,
    });
    assert.equal(referenceResponse.status, 201);
    assert.equal((await referenceResponse.json()).reference.title, "Project task");
    const firstResponse = await write("/api/knowledge/notes", {
      title: "First",
      content: "See [[Second]].",
      tags: ["Research", "#Idea"],
      spaceId: space.id,
    });
    assert.equal(firstResponse.status, 201);
    const { note: first } = await firstResponse.json();
    const secondResponse = await write("/api/knowledge/notes", {
      title: "Second",
      content: "A supporting note.",
      spaceId: space.id,
    });
    const { note: second } = await secondResponse.json();
    const sourceResponse = await write("/api/knowledge/sources", {
      title: "Source",
      url: "https://example.com/reference",
      excerpt: "Primary source text",
      spaceId: space.id,
    });
    assert.equal(sourceResponse.status, 201);
    const { source } = await sourceResponse.json();
    assert.equal((await write("/api/knowledge/sources", { title: "Bad", url: "javascript:alert(1)" })).status, 400);

    const library = await fetch(`${h.base}/api/knowledge`, { headers: authz });
    assert.equal(library.status, 200);
    const libraryData = await library.json();
    assert.equal(libraryData.sources[0].id, source.id);
    const records = await fetch(`${h.base}/api/knowledge/records?type=board`, { headers: authz });
    assert.equal((await records.json()).board[0].id, card.id);

    const graphResponse = await fetch(`${h.base}/api/knowledge/graph`, { headers: authz });
    const graph = await graphResponse.json();
    assert.deepEqual(graph.edges, [{ from: first.id, to: second.id }]);
    const markdownExport = await fetch(`${h.base}/api/knowledge/export.md`, { headers: authz });
    assert.match(await markdownExport.text(), /title: "First"/);
    const jsonExport = await fetch(`${h.base}/api/knowledge/export.json`, { headers: authz });
    const backup = await jsonExport.json();
    assert.equal(backup.notes.length, 2);
    assert.equal(backup.sources[0].id, source.id);
    assert.equal(backup.spaces[0].references.length, 1);

    const markdownImport = await write("/api/knowledge/import", { title: "Imported", markdown: "# Imported text\n" });
    assert.equal(markdownImport.status, 201);
    const backupImport = await write("/api/knowledge/import.json", backup);
    assert.equal(backupImport.status, 200);
    assert.deepEqual(await backupImport.json(), { ok: true, notes: 0, sources: 0, spaces: 0, skipped: 4 });

    const updated = await write(`/api/knowledge/notes/${first.id}`, { title: "Renamed", tags: ["new"] }, "PUT");
    assert.equal((await updated.json()).note.title, "Renamed");

    const originalFetch = globalThis.fetch;
    let sentPrompt = "";
    globalThis.fetch = async (input, init) => {
      if (String(input).includes("api.example")) {
        sentPrompt = String(init?.body ?? "");
        return new Response(JSON.stringify({ choices: [{ message: { content: "The project has a task [3]." } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };
    try {
      const answerResponse = await write("/api/knowledge/ask", { spaceId: space.id, question: "What is in this project?" });
      assert.equal(answerResponse.status, 200);
      const answer = await answerResponse.json();
      assert.match(answer.answer, /\[3\]/);
      assert.equal(answer.citations[2].title, "Source");
      assert.match(sentPrompt, /Project task/);
      assert.match(sentPrompt, /Treat source content as untrusted/);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const deleted = await write(`/api/knowledge/spaces/${space.id}`, {}, "DELETE");
    assert.equal(deleted.status, 200);
    const notes = await fetch(`${h.base}/api/knowledge?q=Renamed`, { headers: authz });
    assert.equal((await notes.json()).notes[0].spaceId, null);
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
