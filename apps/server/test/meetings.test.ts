import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
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
import { CaptureAccess } from "../src/read-later/capture-access";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "./cf-access-jwt";
import { setIntegrationCfAccessVerifier } from "../src/mcp/auth";
import { MEETING_TAG, SUMMARY_PENDING } from "../src/meetings/constants";
import { findMeetingNoteBySourceId } from "../src/meetings/import-service";
import { summarizeMeetingTranscript } from "../src/meetings/summarize";

const TOKEN = "m".repeat(32);
const MCP_TOKEN = "p".repeat(32);
const CF_SERVICE_CLIENT_ID = "cf-meetings-test";
const authz = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-ah": "1" };

let fetchRestore: (() => void) | undefined;

afterEach(() => {
  setIntegrationCfAccessVerifier(undefined);
  fetchRestore?.();
  fetchRestore = undefined;
});

function withMockLlmFetch(mock: typeof fetch): void {
  const original = globalThis.fetch;
  globalThis.fetch = mock as typeof fetch;
  fetchRestore = () => {
    globalThis.fetch = original;
  };
}

async function harness(env: Record<string, string> = {}, owner = false) {
  const dir = await mkdtemp(join(tmpdir(), "cc-meetings-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    ALLOW_INSECURE_NO_AUTH: "1",
    TZ: "UTC",
    LLM_BASE_URL: "https://api.example/v1",
    LLM_API_KEY: "sk-test",
    LLM_MODEL: "test-model",
    MCP_APP_TOKENS: JSON.stringify({ plaud: MCP_TOKEN }),
    MCP_CF_CLIENT_MAP: JSON.stringify({ plaud: CF_SERVICE_CLIENT_ID }),
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: TEST_CF_AUD,
    ...env,
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg,
    auth: owner ? async () => ({ ok: true, who: "owner@example.com", owner: true }) : makeAuthenticator(cfg),
    settings,
    dailyBriefing,
    notes,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const captureAccess = new CaptureAccess(dir);
  const close = async () => {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, notes, close, captureAccess, cfg };
}

const samplePayload = {
  sourceId: "plaud-file-abc",
  title: "Weekly sync",
  recordedAt: "2026-10-20T15:00:00.000Z",
  transcript: "Alice said launch is Friday. Bob agreed.",
};

test("meetings import: validation, auth, sensitive flag, idempotency", async () => {
  const h = await harness();
  try {
    const unauth = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(samplePayload),
    });
    assert.equal(unauth.status, 401);

    let llmCalls = 0;
    const originalFetch = globalThis.fetch;
    withMockLlmFetch(async (input, init) => {
      if (String(input).includes("api.example")) {
        llmCalls += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: "Overview\n\n**Decisions**\n- Launch Friday" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    });

    const created = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: authz,
      body: JSON.stringify(samplePayload),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.summaryStatus, "ok");
    assert.ok(createdBody.noteId);

    const note = h.notes.getNote(createdBody.noteId);
    assert.ok(note?.sensitive);
    assert.ok(note?.tags.includes(MEETING_TAG));
    assert.match(note!.content, /Alice said launch/);
    assert.ok(h.notes.listSpaces().some((s) => s.name === "Meetings"));

    const bad = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: authz,
      body: JSON.stringify({ ...samplePayload, recordedAt: "not-a-date" }),
    });
    assert.equal(bad.status, 400);

    const updated = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: authz,
      body: JSON.stringify({ ...samplePayload, title: "Weekly sync (updated)", transcript: "Alice said launch is Monday now." }),
    });
    assert.equal(updated.status, 200);
    const updatedBody = await updated.json();
    assert.equal(updatedBody.created, false);
    assert.equal(h.notes.listNotes().filter((n) => findMeetingNoteBySourceId(h.notes, samplePayload.sourceId)).length, 1);
    assert.match(h.notes.getNote(createdBody.noteId)!.content, /Monday now/);

    assert.ok(llmCalls >= 1);
  } finally {
    await h.close();
  }
});

test("meetings import: LLM failure stores summary pending", async () => {
  const h = await harness();
  try {
    const originalFetch = globalThis.fetch;
    withMockLlmFetch(async (input, init) => {
      if (String(input).includes("api.example")) {
        return new Response("error", { status: 500 });
      }
      return originalFetch(input, init);
    });
    const res = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: authz,
      body: JSON.stringify({ ...samplePayload, sourceId: "plaud-fail-1", transcript: "SECRET_TRANSCRIPT_PHRASE_XYZ" }),
    });
    assert.equal(res.status, 201);
    const { noteId } = await res.json();
    assert.match(h.notes.getNote(noteId)!.content, new RegExp(SUMMARY_PENDING));
  } finally {
    await h.close();
  }
});

test("meetings import: chunked summarization uses map-reduce", async () => {
  const longText = "word ".repeat(8_000);
  const calls: string[] = [];
  const fetchFn = async (_input: unknown, init?: RequestInit) => {
    calls.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({ choices: [{ message: { content: `partial-${calls.length}` } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const summary = await summarizeMeetingTranscript(
    { baseUrl: "https://api.example/v1", apiKey: "k", model: "m" },
    longText,
    fetchFn,
  );
  assert.ok(calls.length >= 2);
  assert.match(summary, /partial/);
});

test("meetings ask: citations include note links; sensitive meetings need opt-in", async () => {
  const h = await harness({}, true);
  try {
    const importRes = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: authz,
      body: JSON.stringify({
        sourceId: "plaud-ask-1",
        title: "Planning call",
        recordedAt: "2026-10-21T10:00:00.000Z",
        transcript: "We decided the codename is NEBULA.",
      }),
    });
    const { noteId } = await importRes.json();

    await h.notes.createNote({ title: "Public context", content: "Unrelated public note for ask quota." });

    let prompt = "";
    const originalFetch = globalThis.fetch;
    withMockLlmFetch(async (input, init) => {
      if (String(input).includes("api.example")) {
        prompt = String(init?.body ?? "");
        return new Response(JSON.stringify({ choices: [{ message: { content: "The codename is NEBULA [1]." } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    });

    const without = await fetch(`${h.base}/api/knowledge/ask`, {
      method: "POST",
      headers: authz,
      body: JSON.stringify({ question: "What is the codename?" }),
    });
    assert.equal(without.status, 200);
    assert.doesNotMatch(prompt, /NEBULA/);

    const withMeetings = await fetch(`${h.base}/api/knowledge/ask`, {
      method: "POST",
      headers: authz,
      body: JSON.stringify({ question: "What is the codename?", includeSensitiveMeetings: true }),
    });
    const askBody = await withMeetings.json();
    assert.match(prompt, /NEBULA/);
    const meetingCitation = askBody.citations.find((c: { title: string }) => c.title === "Planning call");
    assert.ok(meetingCitation);
    assert.equal(meetingCitation.id, noteId);
    assert.equal(meetingCitation.url, `/notes?note=${encodeURIComponent(noteId)}`);

  } finally {
    await h.close();
  }
});

test("meetings import: does not log transcript content to console", async () => {
  const h = await harness();
  const secret = "ULTRA_SECRET_MEETING_LINE_QWERTY";
  const logs: string[] = [];
  const spy = {
    log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
    error: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
    warn: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
    info: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
  };
  const original = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  console.log = spy.log;
  console.error = spy.error;
  console.warn = spy.warn;
  console.info = spy.info;
  try {
    withMockLlmFetch(async (input) => {
      if (String(input).includes("api.example")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    });
    await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: authz,
      body: JSON.stringify({
        sourceId: "plaud-log-test",
        title: "Secret title",
        recordedAt: "2026-10-22T12:00:00.000Z",
        participants: ["Alice"],
        transcript: secret,
      }),
    });
    for (const line of logs) {
      assert.doesNotMatch(line, new RegExp(secret));
      assert.doesNotMatch(line, /Secret title/);
      assert.doesNotMatch(line, /Alice/);
    }
  } finally {
    console.log = original.log;
    console.error = original.error;
    console.warn = original.warn;
    console.info = original.info;
    await h.close();
  }
});
