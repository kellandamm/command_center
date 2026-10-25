import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { CalendarWorkspace } from "../src/calendar/workspace";
import { loadConfig, type Config } from "../src/config";
import { makeAuthenticator, type Authenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { VoiceCaptureStore } from "../src/voice-capture/store";
import { VOICE_CAPTURE_TRANSCRIPTION_UNAVAILABLE, VOICE_CAPTURE_UNAUTHORIZED } from "../src/voice-capture/errors";
import { VOICE_CAPTURE_MAX_BYTES } from "../src/voice-capture/limits";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const ADMIN = "a".repeat(32);
const TRANSCRIPT_MARKER = "voice-capture-secret-transcript-xyzzy";

function llmItemsJson() {
  return JSON.stringify({
    items: [
      { kind: "task", title: "Call dentist", due: "2026-10-26T09:00" },
      { kind: "event", title: "Lunch with Sam", start: "2026-10-31T12:00", end: "2026-10-31T13:00" },
    ],
  });
}

function stubFetch(original: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (url.includes("/audio/transcriptions")) {
      return new Response(JSON.stringify({ text: TRANSCRIPT_MARKER }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("llm.example") && url.includes("chat/completions")) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: llmItemsJson() } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("api.todoist.com/rest/v2/tasks") && init?.method === "POST") {
      return new Response(JSON.stringify({
        id: "td-voice",
        content: "Call dentist",
        description: "",
        priority: 1,
        due: null,
        url: "https://todoist.com/showTask?id=td-voice",
      }), { status: 200 });
    }
    return original(input, init);
  };
}

async function openHarness(env: Record<string, string> = {}, authFor?: (cfg: Config) => Authenticator) {
  const dir = await mkdtemp(join(tmpdir(), "cc-voice-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: ADMIN,
    ALLOW_INSECURE_NO_AUTH: "1",
    TZ: "America/Chicago",
    LLM_BASE_URL: "https://llm.example/v1",
    LLM_API_KEY: "key",
    LLM_MODEL: "model",
    TRANSCRIBE_URL: "http://whisper.internal:8000/v1",
    TODOIST_API_TOKEN: "todoist-token",
    ...env,
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board: integration.board });
  const server = createApp({
    cfg,
    auth: authFor ? authFor(cfg) : makeAuthenticator(cfg),
    settings,
    dailyBriefing,
    notes,
    calendar,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const session = { authorization: `Bearer ${ADMIN}`, "x-ah": "1", "content-type": "application/json" };
  const close = async () => {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, session, cfg, calendar, dir, close };
}

async function captureToken(base: string, session: Record<string, string>) {
  const res = await fetch(`${base}/api/capture/access`, { method: "POST", headers: session });
  const { token } = await res.json() as { token: string };
  return token;
}

test("voice capture audio: auth required", async () => {
  const h = await openHarness();
  try {
    const noAuth = await fetch(`${h.base}/api/capture/audio`, {
      method: "POST",
      headers: { "content-type": "audio/m4a" },
      body: Buffer.from("fake"),
    });
    assert.equal(noAuth.status, 401);
    assert.equal((await noAuth.json() as { error: string }).error, VOICE_CAPTURE_UNAUTHORIZED);

    const token = await captureToken(h.base, h.session);
    const bad = await fetch(`${h.base}/api/capture/audio`, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token", "content-type": "audio/m4a" },
      body: Buffer.from("fake"),
    });
    assert.equal(bad.status, 401);
  } finally {
    await h.close();
  }
});

test("voice capture audio: content-type and size limits", async () => {
  const h = await openHarness();
  try {
    const token = await captureToken(h.base, h.session);
    const jsonBody = await fetch(`${h.base}/api/capture/audio`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(jsonBody.status, 400);

    const huge = Buffer.alloc(VOICE_CAPTURE_MAX_BYTES + 1, 1);
    const big = await fetch(`${h.base}/api/capture/audio`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "audio/m4a" },
      body: huge,
    });
    assert.equal(big.status, 400);
  } finally {
    await h.close();
  }
});

test("voice capture audio: stubbed pipeline creates pending capture without external writes", async () => {
  const h = await openHarness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch(originalFetch);
  let todoistPosts = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("api.todoist.com") && init?.method === "POST") todoistPosts++;
    return stubFetch(originalFetch)(input, init);
  };
  const logSpy: unknown[][] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args) => { logSpy.push(args); origLog(...args); };
  console.error = (...args) => { logSpy.push(args); origError(...args); };
  try {
    const token = await captureToken(h.base, h.session);
    const beforeEvents = h.calendar.store.events().length;
    const res = await fetch(`${h.base}/api/capture/audio`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "audio/m4a" },
      body: Buffer.from("not-real-m4a"),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as { id: string; transcript: string; items: unknown[] };
    assert.equal(body.items.length, 2);
    assert.equal(body.transcript, TRANSCRIPT_MARKER);
    assert.equal(todoistPosts, 0);
    assert.equal(h.calendar.store.events().length, beforeEvents);

    const list = await (await fetch(`${h.base}/api/voice-captures`, { headers: h.session })).json() as { count: number };
    assert.equal(list.count, 1);

    const serialized = logSpy.map((row) => row.map(String).join(" ")).join("\n");
    assert.equal(serialized.includes(TRANSCRIPT_MARKER), false);
    assert.equal(serialized.includes("Call dentist"), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = origLog;
    console.error = origError;
    await h.close();
  }
});

test("voice capture: confirm commits and dismiss removes", async () => {
  const ownerJwt = "owner-voice-session";
  const h = await openHarness(
    { OWNER_EMAILS: "owner@example.com" },
    (cfg) => makeAuthenticator(cfg, async (token) => {
      if (token === ownerJwt) return { email: "owner@example.com" };
      throw new Error("invalid session");
    }),
  );
  const ownerSession = {
    "cf-access-jwt-assertion": ownerJwt,
    "x-ah": "1",
    "content-type": "application/json",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch(originalFetch);
  try {
    const token = await captureToken(h.base, h.session);
    const created = await fetch(`${h.base}/api/capture/audio`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "audio/mp4" },
      body: Buffer.from("audio-bytes"),
    });
    const { id, items } = await created.json() as { id: string; items: unknown[] };
    const cal = await h.calendar.create({ kind: "native", name: "Personal" });
    const confirm = await fetch(`${h.base}/api/voice-captures/${id}/confirm`, {
      method: "POST",
      headers: ownerSession,
      body: JSON.stringify({ items, calendarId: cal.id }),
    });
    assert.equal(confirm.status, 200);
    const data = await confirm.json() as { results: unknown[] };
    assert.equal(data.results.length, 2);
    assert.equal(h.calendar.store.events().length, 1);

    const gone = await fetch(`${h.base}/api/voice-captures/${id}`, { headers: ownerSession });
    assert.equal(gone.status, 404);

    const created2 = await fetch(`${h.base}/api/capture/audio`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "audio/m4a" },
      body: Buffer.from("x"),
    });
    const { id: id2 } = await created2.json() as { id: string };
    const dismissed = await fetch(`${h.base}/api/voice-captures/${id2}`, { method: "DELETE", headers: ownerSession });
    assert.equal(dismissed.status, 200);
    const list = await (await fetch(`${h.base}/api/voice-captures`, { headers: ownerSession })).json() as { count: number };
    assert.equal(list.count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await h.close();
  }
});

test("voice capture store: expired pending records are purged on open", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-voice-exp-"));
  try {
    await writeFile(join(dir, "voice-captures.json"), JSON.stringify({
      captures: [{
        id: "expiredcap",
        createdAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-01-02T00:00:00.000Z",
        transcript: "old",
        items: [{ kind: "task", title: "Old" }],
      }],
    }), "utf8");
    const store = await VoiceCaptureStore.open(dir);
    assert.equal(store.pendingCount(), 0);
    const raw = await readFile(join(dir, "voice-captures.json"), "utf8");
    assert.equal(raw.includes("expiredcap"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("voice capture audio: transcription not configured returns 503", async () => {
  const h = await openHarness({
    LLM_BASE_URL: "",
    LLM_API_KEY: "",
    LLM_MODEL: "",
    TRANSCRIBE_URL: "",
  });
  try {
    const token = await captureToken(h.base, h.session);
    const res = await fetch(`${h.base}/api/capture/audio`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "audio/m4a" },
      body: Buffer.from("x"),
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json() as { error: string }).error, VOICE_CAPTURE_TRANSCRIPTION_UNAVAILABLE);
  } finally {
    await h.close();
  }
});
