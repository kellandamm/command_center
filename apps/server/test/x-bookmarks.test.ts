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
import { extractArticleText } from "../src/read-later/article-text";
import { XBookmarksService } from "../src/read-later/x-bookmarks-service";
import { XBookmarksStore } from "../src/read-later/x-bookmarks-store";
import { BlockedUrlError, assertPublicUrl } from "../src/ssrf";

const TOKEN = "t".repeat(32);
const IMPORT_SECRET = "s".repeat(32);
const authz = { authorization: `Bearer ${TOKEN}`, "x-ah": "1", "content-type": "application/json" };

afterEach(() => setIntegrationCfAccessVerifier(undefined));

async function accessJwtHeaders() {
  const keys = await createTestCfAccessJwt();
  setIntegrationCfAccessVerifier(keys.verifier);
  const jwt = await keys.signServiceTokenJwt("bookmarks-bot");
  return { "cf-access-jwt-assertion": jwt };
}

async function harness(env: Record<string, string> = {}, serviceDeps?: ConstructorParameters<typeof XBookmarksService>[2]) {
  const dir = await mkdtemp(join(tmpdir(), "cc-xb-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    TZ: "UTC",
    LLM_BASE_URL: "https://api.example/v1",
    LLM_API_KEY: "sk-test",
    LLM_MODEL: "test-model",
    BOOKMARKS_IMPORT_SECRET: IMPORT_SECRET,
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: TEST_CF_AUD,
    ...env,
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const integration = await openIntegrationStores(dir, cfg);
  if (serviceDeps) {
    integration.xBookmarksService = new XBookmarksService(cfg, integration.xBookmarks, serviceDeps);
  }
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg),
    settings,
    dailyBriefing: await DailyBriefingService.open(dir, cfg.tz),
    notes: await NotesStore.open(dir),
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    xBookmarks: integration.xBookmarks,
    xBookmarksService: integration.xBookmarksService,
    close: async () => {
      await closeIntegrationServer(server, integration);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const sampleItem = {
  post_id: "123",
  post_url: "https://x.com/user/status/123",
  author_handle: "user",
  text: "Check this out",
  created_at: "2026-10-20T12:00:00.000Z",
  urls: ["https://example.com/article"],
};

test("x bookmarks: article links are selected by hostname", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-xb-links-"));
  try {
    const store = await XBookmarksStore.open(dir);
    await store.importItems([{ ...sampleItem, post_id: "host-check", urls: [
      "https://x.com/user/status/124",
      "https://news.example/x.com/story",
    ] }]);
    assert.equal(store.getByPostId("host-check")?.articleUrl, "https://news.example/x.com/story");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("article extraction removes script blocks with whitespace in closing tags", () => {
  assert.equal(extractArticleText("<article>Visible<script>secret</script   > text</article>"), "Visible text");
});

test("x bookmarks: idempotent import and single summarizer call", async () => {
  let llmCalls = 0;
  const h = await harness({}, {
    fetchArticle: async () => ({ status: 200, contentType: "text/html", body: "<article><p>Body</p></article>" }),
    llmFetch: async () => {
      llmCalls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bullets: ["a", "b", "c"], why_it_matters: "It matters" }) } }] }), { status: 200 });
    },
  });
  try {
    const jwtHdr = await accessJwtHeaders();
    const headers = { ...jwtHdr, "x-bookmarks-secret": IMPORT_SECRET, "content-type": "application/json" };
    const body = JSON.stringify({ items: [sampleItem] });
    const first = await fetch(`${h.base}/api/bookmarks/import`, { method: "POST", headers, body });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { imported: 1, duplicates: 0, rejected: [] });
    const second = await fetch(`${h.base}/api/bookmarks/import`, { method: "POST", headers, body });
    assert.deepEqual(await second.json(), { imported: 0, duplicates: 1, rejected: [] });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(llmCalls, 1);
    assert.equal(h.xBookmarks.list().filter((item) => item.status === "done").length, 1);
  } finally {
    await h.close();
  }
});

test("x bookmarks: auth rejects missing JWT and bad secret", async () => {
  const h = await harness();
  try {
    const dir = await mkdtemp(join(tmpdir(), "cc-xb-off-"));
    const offCfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, TZ: "UTC", CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM, CF_ACCESS_AUD: TEST_CF_AUD });
    const offIntegration = await openIntegrationStores(dir, offCfg);
    const offSettings = new SettingsStore(dir);
    await offSettings.load();
    const offServer = createApp({
      cfg: offCfg,
      auth: makeAuthenticator(offCfg),
      settings: offSettings,
      dailyBriefing: await DailyBriefingService.open(dir, offCfg.tz),
      notes: await NotesStore.open(dir),
      ...offIntegration,
    });
    await new Promise<void>((r) => offServer.listen(0, "127.0.0.1", r));
    const offBase = `http://127.0.0.1:${(offServer.address() as AddressInfo).port}`;
    const off = await fetch(`${offBase}/api/bookmarks/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [sampleItem] }),
    });
    assert.equal(off.status, 404);
    await new Promise<void>((resolve, reject) => offServer.close((err) => err ? reject(err) : resolve()));
    await rm(dir, { recursive: true, force: true });

    const noJwt = await fetch(`${h.base}/api/bookmarks/import`, {
      method: "POST",
      headers: { "x-bookmarks-secret": IMPORT_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ items: [sampleItem] }),
    });
    assert.equal(noJwt.status, 403);

    const jwtHdr = await accessJwtHeaders();
    const badSecret = await fetch(`${h.base}/api/bookmarks/import`, {
      method: "POST",
      headers: { ...jwtHdr, "x-bookmarks-secret": "x".repeat(32), "content-type": "application/json" },
      body: JSON.stringify({ items: [sampleItem] }),
    });
    assert.equal(badSecret.status, 401);
  } finally {
    await h.close();
  }
});

test("x bookmarks: summarizer failure retries once then marks failed", async () => {
  let llmCalls = 0;
  const h = await harness({}, {
    fetchArticle: async () => ({ status: 200, contentType: "text/plain", body: "hello" }),
    llmFetch: async () => {
      llmCalls += 1;
      return new Response("nope", { status: 500 });
    },
  });
  try {
    const jwtHdr = await accessJwtHeaders();
    await fetch(`${h.base}/api/bookmarks/import`, {
      method: "POST",
      headers: { ...jwtHdr, "x-bookmarks-secret": IMPORT_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ ...sampleItem, post_id: "retry-me" }] }),
    });
    await new Promise((r) => setTimeout(r, 500));
    const item = h.xBookmarks.getByPostId("retry-me")!;
    assert.equal(item.attempts, 2);
    assert.equal(item.status, "failed");
    assert.ok(item.failureReason);
    assert.equal(llmCalls, 2);
  } finally {
    await h.close();
  }
});

test("x bookmarks: no-link post summarizes from text", async () => {
  const h = await harness({}, {
    llmFetch: async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      const user = payload.messages[1].content as string;
      assert.match(user, /Post by @user/);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bullets: ["one", "two", "three"], why_it_matters: "Useful" }) } }] }), { status: 200 });
    },
  });
  try {
    const jwtHdr = await accessJwtHeaders();
    await fetch(`${h.base}/api/bookmarks/import`, {
      method: "POST",
      headers: { ...jwtHdr, "x-bookmarks-secret": IMPORT_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ ...sampleItem, post_id: "nolink", urls: [] }] }),
    });
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(h.xBookmarks.getByPostId("nolink")?.status, "done");
  } finally {
    await h.close();
  }
});

test("x bookmarks: ssrf guard blocks private and non-http targets", async () => {
  for (const bad of ["http://127.0.0.1/", "http://169.254.169.254/", "http://[::1]/", "file:///etc/passwd"]) {
    await assert.rejects(assertPublicUrl(bad), BlockedUrlError);
  }
  await assert.rejects(assertPublicUrl("https://evil.example/", async () => ["10.0.0.1"]), BlockedUrlError);
  await assert.rejects(assertPublicUrl("https://example.com/", async () => ["::ffff:127.0.0.1"]), BlockedUrlError);
});
