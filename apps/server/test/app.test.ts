import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { BriefingService } from "../src/briefing/service";
import { AiSecurityService } from "../src/ai-security/service";
import { loadConfig, assertAuthConfigured, llmConfigured } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { FeedsStore } from "../src/feeds/store";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";

const TOKEN = "t".repeat(32);

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
  const briefing = await BriefingService.open(dir, cfg.tz);
  const aiSecurity = await AiSecurityService.open(dir);
  const notes = await NotesStore.open(dir);
  const server = createApp({ cfg, auth: makeAuthenticator(cfg), settings, feeds, briefing, aiSecurity, notes });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
  };
  return { base, settings, feeds, briefing, close, cfg };
}
const authz = { authorization: `Bearer ${TOKEN}` };

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

test("settings API validates and persists feeds", async () => {
  const h = await harness();
  try {
    const put = (body: unknown) =>
      fetch(`${h.base}/api/settings`, {
        method: "PUT",
        headers: { ...authz, "x-ah": "1", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const ok = await put({ feeds: "hn\nnot a url", fetchIntervalMinutes: 20 });
    assert.equal(ok.status, 200);
    const j: any = await ok.json();
    assert.equal(j.feedCount, 1);
    assert.equal(j.feedErrors[0].line, 2);
    assert.equal(h.settings.get().fetchIntervalMinutes, 20);
    assert.equal((await put({ briefingTime: "99:99" })).status, 400);
  } finally {
    await h.close();
  }
});

test("http: github activity API returns JSON without crashing", async () => {
  const h = await harness();
  try {
    const r = await fetch(`${h.base}/api/github/activity`, { headers: authz });
    assert.equal(r.status, 200);
    const j: any = await r.json();
    assert.ok(j.activity);
    assert.equal(typeof j.activity.username, "string");
    assert.ok(Array.isArray(j.activity.pulls));
    assert.ok(Array.isArray(j.activity.issues));
    assert.ok(Array.isArray(j.activity.events));
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
