import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { BuildManager } from "../src/build";
import { loadConfig, assertAuthConfigured } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { PRICING } from "../src/pricing";
import { SettingsStore } from "../src/settings";
import { EditionStore, FileKV, Ledger, ensureDirs } from "../src/store";

const TSX = `import React from 'react'; export default function PersonalizedHomepage(){ return <h1>ok</h1> }`;
const TOKEN = "t".repeat(32);

async function harness(env: Record<string, string> = {}, run?: any) {
  const dir = await mkdtemp(join(tmpdir(), "ah-"));
  const cfg = loadConfig({ DATA_DIR: dir, ANTHROPIC_API_KEY: "sk-test", ADMIN_TOKEN: TOKEN, TZ: "UTC", ...env });
  const dirs = await ensureDirs(dir);
  const kv = await FileKV.open(join(dir, "state.json"));
  const settings = new SettingsStore(dir);
  await settings.load();
  const ledger = new Ledger(join(dir, "ledger.jsonl"));
  const editions = new EditionStore(dirs.editions);
  const scraper = { scrape: async () => { throw new Error("no browser in tests"); }, close: async () => {} } as any;
  const manager = new BuildManager({
    cfg, settings, kv, ledger, editions, pricing: PRICING, scraper,
    makeClient: () => ({}) as any,
    run: run ?? (async () => ({ code: TSX, sessionId: "s", source: "session-output" })),
  });
  const server = createApp({ cfg, auth: makeAuthenticator(cfg), manager, settings, editions, ledger });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => { await manager.close(); server.close(); await rm(dir, { recursive: true, force: true }); };
  return { base, manager, settings, ledger, editions, kv, close, cfg };
}
const authz = { authorization: `Bearer ${TOKEN}` };

test("config: refuses to start without any authentication", () => {
  assert.throws(() => assertAuthConfigured(loadConfig({})), /No authentication/);
  assert.throws(() => loadConfig({ CF_ACCESS_TEAM_DOMAIN: "x.cloudflareaccess.com" }), /both/i);
  assert.throws(() => loadConfig({ ADMIN_TOKEN: "short" }), /24/);
  assertAuthConfigured(loadConfig({ ALLOW_INSECURE_NO_AUTH: "1" }));
});

test("http: healthz is open; everything else needs auth; CSRF header is required for writes", async () => {
  const h = await harness();
  try {
    assert.equal((await fetch(`${h.base}/healthz`)).status, 200);
    assert.equal((await fetch(`${h.base}/`)).status, 401);
    assert.equal((await fetch(`${h.base}/api/state`, { headers: { authorization: "Bearer wrong" + "x".repeat(30) } })).status, 401);
    assert.equal((await fetch(`${h.base}/api/state`, { headers: authz })).status, 200);
    // authenticated but no x-ah header
    assert.equal((await fetch(`${h.base}/api/build`, { method: "POST", headers: authz })).status, 403);
    // wrong origin
    assert.equal((await fetch(`${h.base}/api/build`, { method: "POST", headers: { ...authz, "x-ah": "1", origin: "https://evil.example" } })).status, 403);
    const r = await fetch(`${h.base}/?token=${TOKEN}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("set-cookie")!, /HttpOnly/);
    assert.equal(r.headers.get("x-frame-options"), "DENY");
  } finally { await h.close(); }
});

test("http: Cloudflare Access JWT is verified; a bad one is refused", async () => {
  const cfg = loadConfig({ DATA_DIR: "/tmp/x", CF_ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", CF_ACCESS_AUD: "aud" });
  const auth = makeAuthenticator(cfg, async (tok) => { if (tok === "good") return "me@example.com"; throw new Error("bad"); });
  const mk = (h: Record<string, string>) => ({ headers: h }) as any;
  const url = new URL("http://x/");
  assert.deepEqual(await auth(mk({ "cf-access-jwt-assertion": "good" }), url), { ok: true, who: "me@example.com" });
  assert.equal((await auth(mk({ "cf-access-jwt-assertion": "bad" }), url)).ok, false);
  assert.equal((await auth(mk({}), url)).ok, false);
});

test("settings API validates and persists; bad input is a 400", async () => {
  const h = await harness();
  try {
    const put = (body: unknown) => fetch(`${h.base}/api/settings`, { method: "PUT", headers: { ...authz, "x-ah": "1", "content-type": "application/json" }, body: JSON.stringify(body) });
    const ok = await put({ sources: "hn\nnot a url", caps: { daily: 2 } });
    assert.equal(ok.status, 200);
    const j: any = await ok.json();
    assert.equal(j.sourceCount, 1);
    assert.equal(j.sourceErrors[0].line, 2);
    assert.equal(h.settings.get().caps.daily, 2);
    assert.equal((await put({ model: "nope" })).status, 400);
    assert.equal((await put({ times: ["99:99"] })).status, 400);
  } finally { await h.close(); }
});

test("build: success writes an edition and a ledger entry; the viewer serves a sandboxed doc", async () => {
  const h = await harness();
  try {
    const start = await h.manager.start("manual");
    assert.ok(start.ok);
    await h.manager.idle();
    const st = h.manager.status();
    assert.equal(st.last?.status, "ok");
    const list = await h.editions.list();
    assert.equal(list.length, 1);
    assert.equal((await h.ledger.all()).length, 1);
    const doc = await fetch(`${h.base}/e/${list[0]!.id}/doc`, { headers: authz });
    assert.equal(doc.status, 200);
    assert.match(doc.headers.get("content-security-policy")!, /^sandbox allow-scripts/);
    assert.equal((await fetch(`${h.base}/e/..%2F..%2Fetc%2Fpasswd/doc`, { headers: authz })).status, 404);
    assert.equal((await fetch(`${h.base}/e/20260101-000000-zzzz`, { headers: authz })).status, 404);
  } finally { await h.close(); }
});

test("build: the spend cap aborts a running build and records it as capped", async () => {
  let aborted = false;
  const run = async (opts: any) => {
    const stopped = new Promise((_, rej) => opts.signal.addEventListener("abort", () => { aborted = true; rej(new Error("aborted")); }));
    opts.callbacks.onModelUsage({ inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }); // $10 on Sonnet
    await stopped;
  };
  const h = await harness({}, run);
  try {
    await h.settings.update({ caps: { perBuild: 1.5 } });
    assert.ok((await h.manager.start("manual")).ok);
    await h.manager.idle();
    assert.ok(aborted);
    assert.equal(h.manager.status().last?.status, "capped");
    assert.equal((await h.editions.list()).length, 0);
    const [entry] = await h.ledger.all();
    assert.equal(entry!.status, "capped");
    assert.ok(entry!.costUsd >= 10);
  } finally { await h.close(); }
});

test("build: caps are enforced before starting (daily spend, builds per day, busy, no key, no sources)", async () => {
  const h = await harness();
  try {
    await h.ledger.append({ ts: new Date().toISOString(), buildId: "x", status: "ok", costUsd: 2.99 });
    const r1 = await h.manager.start("manual");
    assert.ok(!r1.ok && r1.code === "cap", JSON.stringify(r1));
    await h.settings.update({ caps: { daily: 100, maxBuildsPerDay: 1 } });
    const r2 = await h.manager.start("manual");
    assert.ok(!r2.ok && /limit/i.test(r2.reason));
    await h.settings.update({ caps: { maxBuildsPerDay: 10 }, sources: "# nothing" });
    const r3 = await h.manager.start("manual");
    assert.ok(!r3.ok && r3.code === "no_sources");
  } finally { await h.close(); }
  const h2 = await harness({ ANTHROPIC_API_KEY: "" });
  try {
    const r = await h2.manager.start("manual");
    assert.ok(!r.ok && r.code === "no_key");
  } finally { await h2.close(); }
});

test("build: the per-build cap is tightened to the money left today", async () => {
  const h = await harness();
  try {
    await h.ledger.append({ ts: new Date().toISOString(), buildId: "x", status: "ok", costUsd: 2.5 });
    const b = await h.manager.budget();
    assert.ok("capUsd" in b && Math.abs(b.capUsd - 0.5) < 1e-9);
  } finally { await h.close(); }
});

test("build: a failed render is a failed build, not a crash, and a second start is rejected while busy", async () => {
  let release: (() => void) | undefined;
  const run = async () => { await new Promise<void>((r) => (release = r)); return { code: "nonsense", sessionId: "s", source: "session-output" }; };
  const h = await harness({}, run);
  try {
    assert.ok((await h.manager.start("manual")).ok);
    const again = await h.manager.start("manual");
    assert.ok(!again.ok && again.code === "busy");
    while (!release) await new Promise((r) => setTimeout(r, 5));
    release();
    await h.manager.idle();
    assert.equal(h.manager.status().last?.status, "failed");
    assert.equal((await h.editions.list()).length, 0);
  } finally { await h.close(); }
});
