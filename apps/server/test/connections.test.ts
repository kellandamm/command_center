import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { ConnectionsStore } from "../src/connections";
import { makeAuthenticator } from "../src/auth";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";

test("encrypted connections survive restart without revealing values and resolve live overrides", async () => {
  const dir = await mkdtemp(join(tmpdir(), "connections-"));
  try {
    const env = loadConfig({ DATA_DIR: dir, CONNECTIONS_MASTER_KEY: "a".repeat(64), BRAVE_SEARCH_API_KEY: "environment-key" });
    const store = await ConnectionsStore.open(env);
    const cfg = store.config;
    assert.equal(cfg.braveSearchApiKey, "environment-key");
    await store.update("brave", { values: { braveSearchApiKey: "saved-sensitive-key" } });
    assert.equal(cfg.braveSearchApiKey, "saved-sensitive-key");
    assert.equal(env.braveSearchApiKey, "environment-key");
    const raw = await readFile(join(dir, "connections.enc.json"), "utf8");
    assert.ok(!raw.includes("saved-sensitive-key"));
    assert.ok(!JSON.stringify(store.status()).includes("saved-sensitive-key"));
    assert.equal((await ConnectionsStore.open(env)).config.braveSearchApiKey, "saved-sensitive-key");
    await store.update("brave", { disabled: true });
    assert.equal(cfg.braveSearchApiKey, null);
    assert.equal((await ConnectionsStore.open(env)).config.braveSearchApiKey, null);
    await store.update("brave", { disabled: false });
    assert.equal(cfg.braveSearchApiKey, "saved-sensitive-key");
    await store.remove("brave");
    assert.equal(cfg.braveSearchApiKey, "environment-key");
    assert.equal(store.status().connections.find((item) => item.id === "brave")!.fields[0]!.source, "environment");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("vault refuses missing/wrong master key and tampering, not success-shaped fallback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "connections-"));
  try {
    const env = loadConfig({ DATA_DIR: dir, CONNECTIONS_MASTER_KEY: "a".repeat(64) });
    const store = await ConnectionsStore.open(env);
    await store.update("brave", { values: { braveSearchApiKey: "secret" } });
    await assert.rejects(ConnectionsStore.open({ ...env, connectionsMasterKey: null }), /restore/i);
    await assert.rejects(ConnectionsStore.open({ ...env, connectionsMasterKey: "b".repeat(64) }), /decrypt/i);
    const path = join(dir, "connections.enc.json");
    const raw = JSON.parse(await readFile(path, "utf8"));
    raw.tag = Buffer.alloc(16).toString("base64");
    await writeFile(path, JSON.stringify(raw));
    await assert.rejects(ConnectionsStore.open(env), /decrypt/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("vault validates writes, serializes updates, and rolls back failed persistence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "connections-"));
  try {
    const env = loadConfig({ DATA_DIR: dir, CONNECTIONS_MASTER_KEY: "a".repeat(64) });
    const store = await ConnectionsStore.open(env);
    await assert.rejects(store.update("brave", { values: { adminToken: "forbidden" } }), /Unknown/);
    await assert.rejects(store.update("brave", { values: { braveSearchApiKey: "" } }), /non-empty/);
    await assert.rejects(store.update("llm", { values: { llmBaseUrl: "http://127.0.0.1" } }), /HTTPS/);
    await assert.rejects(store.update("llm", { values: { llmBaseUrl: "not-a-url" } }), /invalid/);
    await assert.rejects(store.update("llm", { values: { llmBaseUrl: "https://127.0.0.1" } }), /public/);
    await Promise.all([
      store.update("brave", { values: { braveSearchApiKey: "first" } }),
      store.update("github", { values: { githubToken: "second" } }),
    ]);
    assert.equal(store.config.braveSearchApiKey, "first");
    assert.equal(store.config.githubToken, "second");
    const missing = await ConnectionsStore.open({ ...env, dataDir: join(dir, "missing") });
    await assert.rejects(missing.update("brave", { values: { braveSearchApiKey: "not-persisted" } }));
    assert.equal(missing.config.braveSearchApiKey, null);
    const disabled = await ConnectionsStore.open({ ...env, dataDir: join(dir, "other"), connectionsMasterKey: null });
    await assert.rejects(disabled.update("brave", { values: { braveSearchApiKey: "x" } }), /MASTER_KEY/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("provider access tests are bounded, do not follow redirects or echo credential errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "connections-"));
  try {
    const store = await ConnectionsStore.open(loadConfig({ DATA_DIR: dir, BRAVE_SEARCH_API_KEY: "sensitive" }));
    let called = false;
    const result = await store.test("brave", async (url, options) => {
      called = true;
      assert.equal(new URL(url).hostname, "api.search.brave.com");
      assert.equal(options?.maxRedirects, 0);
      assert.equal(options?.headers?.["X-Subscription-Token"], "sensitive");
      return { finalUrl: url, status: 200, contentType: "application/json", headers: {}, body: "{}" };
    });
    assert.ok(called && result.ok);
    const failed = await store.test("brave", async () => { throw new Error("sensitive"); });
    assert.equal(failed.ok, false);
    assert.ok(!failed.message.includes("sensitive"));
    assert.equal((await store.test("llm")).ok, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("deployment validation and admin/anonymous authentication never implicitly grant ownership", async () => {
  assert.throws(() => loadConfig({ CONNECTIONS_MASTER_KEY: "short" }), /32 random bytes/);
  const cfg = loadConfig({ ADMIN_TOKEN: "a".repeat(32), OWNER_EMAILS: " Owner@Example.com " });
  assert.deepEqual(cfg.ownerEmails, ["owner@example.com"]);
  const result = await makeAuthenticator(cfg)({ headers: { authorization: `Bearer ${cfg.adminToken}` } } as IncomingMessage, new URL("https://app.test"));
  assert.equal(result.ok && result.owner === true, false);
  const req = new IncomingMessage(new Socket());
  req.headers["cf-access-jwt-assertion"] = "signed-token";
  const url = new URL("https://app.test");
  const owner = await makeAuthenticator(cfg, async () => ({ email: "Owner@Example.com" }))(req, url);
  assert.equal(owner.ok && owner.owner, true);
  const other = await makeAuthenticator(cfg, async () => ({ email: "someone@example.com" }))(req, url);
  assert.equal(other.ok && other.owner, false);
  const machine = await makeAuthenticator(cfg, async () => ({ email: "owner@example.com", common_name: "service" }))(req, url);
  assert.equal(machine.ok && machine.owner, false);
  const forged = await makeAuthenticator(cfg, async () => { throw new Error("invalid signature"); })(req, url);
  assert.equal(forged.ok, false);
});

test("connection metadata shows effective non-secret values, missing fields and real usage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "connections-status-"));
  try {
    const store = await ConnectionsStore.open(loadConfig({
      DATA_DIR: dir, CONNECTIONS_MASTER_KEY: "a".repeat(64),
      LLM_BASE_URL: "https://models.example/v1", LLM_MODEL: "deployed-model", LLM_API_KEY: "hidden-api-key",
      RECALLIO_URL: "https://recall.example/search?key=private-url-key", CF_ACCESS_CLIENT_ID: "hidden-client-id",
    }));
    const llm = () => store.status().connections.find((item) => item.id === "llm")!;
    assert.equal(llm().fields.find((field) => field.name === "llmBaseUrl")!.value, "https://models.example/v1");
    assert.equal(llm().fields.find((field) => field.name === "llmModel")!.value, "deployed-model");
    assert.equal(llm().fields.find((field) => field.name === "llmApiKey")!.value, null);
    assert.match(llm().usage, /Read Later.*Notes.*Wins/);
    await store.update("llm", { values: { llmModel: "saved-model" } });
    assert.equal(llm().fields.find((field) => field.name === "llmModel")!.value, "saved-model");
    assert.equal(llm().fields.find((field) => field.name === "llmModel")!.source, "saved");
    const recallio = store.status().connections.find((item) => item.id === "recallio")!;
    assert.equal(recallio.configured, false);
    assert.deepEqual(recallio.missingFields, ["cfAccessClientSecret"]);
    const json = JSON.stringify(store.status());
    for (const secret of ["hidden-api-key", "hidden-client-id", "private-url-key"]) assert.ok(!json.includes(secret));
    let called = false;
    assert.equal((await store.test("recallio", async () => { called = true; throw new Error(); })).ok, false);
    assert.equal(called, false);
    await store.update("llm", { disabled: true });
    assert.equal(llm().configured, false);
    assert.ok(llm().fields.every((field) => field.value === null && field.source === "disabled"));
    await store.remove("llm");
    assert.equal(llm().fields.find((field) => field.name === "llmModel")!.value, "deployed-model");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("access checks are timestamped, invalidated by changes and never certify changed credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "connections-check-"));
  try {
    const store = await ConnectionsStore.open(loadConfig({
      DATA_DIR: dir, CONNECTIONS_MASTER_KEY: "a".repeat(64), BRAVE_SEARCH_API_KEY: "before",
    }));
    const status = () => store.status().connections.find((item) => item.id === "brave")!;
    assert.equal(status().lastCheck, null);
    const result = await store.test("brave", async (url) => ({
      finalUrl: url, status: 200, contentType: "application/json", headers: {}, body: "{}",
    }));
    assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
    assert.deepEqual(status().lastCheck, result);
    assert.equal((await ConnectionsStore.open(store.config)).status().connections.find((item) => item.id === "brave")!.lastCheck, null);
    await store.update("brave", { values: { braveSearchApiKey: "after" } });
    assert.equal(status().lastCheck, null);
    const stale = await store.test("brave", async (url) => {
      await store.update("brave", { disabled: true });
      return { finalUrl: url, status: 200, contentType: "application/json", headers: {}, body: "{}" };
    });

    assert.equal(stale.ok, false);
    assert.match(stale.message, /Settings changed/);
    assert.equal(status().lastCheck, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("ntfy metadata matches deployment precedence, default URL and optional token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "connections-ntfy-"));
  try {
    const env = loadConfig({
      DATA_DIR: dir, CONNECTIONS_MASTER_KEY: "a".repeat(64), NTFY_TOPIC: "private-env-topic",
    });
    const store = await ConnectionsStore.open(env);
    const status = () => store.status().connections.find((item) => item.id === "ntfy")!;
    assert.equal(status().configured, true);
    assert.deepEqual(status().missingFields, []);
    assert.equal(status().fields.find((field) => field.name === "ntfyUrl")!.value, "https://ntfy.sh");
    assert.equal(status().fields.find((field) => field.name === "ntfyUrl")!.source, "default");
    await store.update("ntfy", { values: { ntfyTopic: "private-saved-topic" }, disabled: true });
    assert.equal(status().disabled, false);
    assert.equal(status().configured, true);
    assert.equal(status().fields.find((field) => field.name === "ntfyTopic")!.source, "environment");
    for (const secret of ["private-env-topic", "private-saved-topic"]) assert.ok(!JSON.stringify(status()).includes(secret));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
