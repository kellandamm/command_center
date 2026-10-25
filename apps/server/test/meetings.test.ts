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
import { finalizeMeetingNoteContent } from "../src/meetings/content";
import { MEETING_IMPORT_MAX_BYTES, MEETING_TAG, NOTE_BODY_MAX_BYTES, SUMMARY_PENDING } from "../src/meetings/constants";
import { findMeetingNoteBySourceId } from "../src/meetings/import-service";
import { CHUNK_CHARS, mergeMeetingPartials, summarizeMeetingTranscript } from "../src/meetings/summarize";

const llmStub = { baseUrl: "https://api.example/v1", apiKey: "k", model: "m" };

async function assertMergePreservesPartials(partialCount: number): Promise<void> {
  const partials = Array.from({ length: partialCount }, (_, index) => `[[partial-${index}]]${"x".repeat(7000)}`);
  const mergeBodies: string[] = [];
  let calls = 0;
  const maxCalls = partialCount + Math.ceil(Math.log2(partialCount)) + 2;
  await mergeMeetingPartials(llmStub, partials, async (_input, init) => {
    calls += 1;
    const body = String(init?.body ?? "");
    if (body.includes("Merge partial")) mergeBodies.push(body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "z".repeat(7000) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  assert.ok(calls <= maxCalls, `expected <= ${maxCalls} LLM calls, got ${calls}`);
  for (let index = 0; index < partialCount; index++) {
    assert.ok(
      mergeBodies.some((body) => body.includes(`[[partial-${index}]]`)),
      `partial ${index} never reached a merge prompt`,
    );
  }
}

const ADMIN_TOKEN = "a".repeat(32);
const IMPORT_TOKEN = "i".repeat(32);
const MCP_TOKEN = "p".repeat(32);
const CF_SERVICE_CLIENT_ID = "cf-meetings-test";
const sessionAuthz = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json", "x-ah": "1" };
const importAuthz = { authorization: `Bearer ${IMPORT_TOKEN}`, "content-type": "application/json" };

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
    ADMIN_TOKEN,
    MEETINGS_IMPORT_TOKEN: IMPORT_TOKEN,
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
  const close = async () => {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, notes, close, cfg };
}

const samplePayload = {
  sourceId: "plaud-file-abc",
  title: "Weekly sync",
  recordedAt: "2026-10-20T15:00:00.000Z",
  transcript: "Alice said launch is Friday. Bob agreed.",
};

test("meetings import: validation, import token auth, sensitive flag, idempotency", async () => {
  const h = await harness();
  try {
    const unauth = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(samplePayload),
    });
    assert.equal(unauth.status, 401);

    const adminDenied = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: sessionAuthz,
      body: JSON.stringify(samplePayload),
    });
    assert.equal(adminDenied.status, 401);

    const capture = new CaptureAccess(h.cfg.dataDir);
    const captureToken = await capture.rotate();
    const captureDenied = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: { authorization: `Bearer ${captureToken}`, "content-type": "application/json" },
      body: JSON.stringify(samplePayload),
    });
    assert.equal(captureDenied.status, 401);

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
      headers: importAuthz,
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
    assert.doesNotMatch(note!.content, /^---/m);
    assert.match(note!.content, /Recorded:.*10:00 AM CT/);
    assert.doesNotMatch(note!.content, /2026-10-20T15:00:00\.000Z/);
    assert.ok(h.notes.listSpaces().some((s) => s.name === "Meetings"));

    const offsetOk = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({ ...samplePayload, recordedAt: "2026-10-20T10:00:00-05:00" }),
    });
    assert.equal(offsetOk.status, 200);

    const bad = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({ ...samplePayload, recordedAt: "not-a-date" }),
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "invalid recordedAt");

    const huge = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({
        ...samplePayload,
        sourceId: "plaud-huge",
        transcript: "x".repeat(MEETING_IMPORT_MAX_BYTES + 1),
      }),
    });
    assert.equal(huge.status, 400);
    const hugeError = (await huge.json()).error;
    assert.ok(hugeError === "transcript too large" || hugeError === "payload too large");

    const updated = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({ ...samplePayload, title: "Weekly sync (updated)", transcript: "Alice said launch is Monday now." }),
    });
    assert.equal(updated.status, 200);
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
      headers: importAuthz,
      body: JSON.stringify({ ...samplePayload, sourceId: "plaud-fail-1", transcript: "SECRET_TRANSCRIPT_PHRASE_XYZ" }),
    });
    assert.equal(res.status, 201);
    const { noteId } = await res.json();
    assert.match(h.notes.getNote(noteId)!.content, new RegExp(SUMMARY_PENDING));
  } finally {
    await h.close();
  }
});

test("meetings merge: 3 oversized partials shrink and merge with bounded LLM calls", async () => {
  await assertMergePreservesPartials(3);
});

test("meetings merge: 20 oversized partials shrink and merge with bounded LLM calls", async () => {
  await assertMergePreservesPartials(20);
});

test("meetings import: long transcript uses chunk plus merge passes", async () => {
  const longText = "segment ".repeat(Math.ceil((CHUNK_CHARS * 3) / "segment ".length));
  let llmCalls = 0;
  const summary = await summarizeMeetingTranscript(llmStub, longText, async (_input, init) => {
    llmCalls += 1;
    const body = String(init?.body ?? "");
    const content = body.includes("transcript excerpt") ? `[[chunk-${llmCalls}]]${"s".repeat(7000)}` : "z".repeat(7000);
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  assert.ok(llmCalls >= 4 && llmCalls <= 10);
  assert.ok(summary.length > 0);
});

test("meetings import: sourceId lock uses normalized id", async () => {
  const h = await harness();
  try {
    const originalFetch = globalThis.fetch;
    withMockLlmFetch(async (input, init) => {
      if (String(input).includes("api.example")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    });
    const body = { ...samplePayload, sourceId: "Plaud-Case-ABC", transcript: "one" };
    assert.equal((await fetch(`${h.base}/api/meetings/import`, { method: "POST", headers: importAuthz, body: JSON.stringify(body) })).status, 201);
    const second = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({ ...body, sourceId: "plaud-case-abc", transcript: "two" }),
    });
    assert.equal(second.status, 200);
    assert.equal(h.notes.listNotes().filter((n) => n.tags.some((t) => t.startsWith("plaud:"))).length, 1);
    assert.match(h.notes.getNote((await second.json()).noteId)!.content, /two/);
  } finally {
    await h.close();
  }
});

test("meetings summarize: refresh import version so re-import is allowed", async () => {
  const h = await harness({}, true);
  try {
    const originalFetch = globalThis.fetch;
    withMockLlmFetch(async (input, init) => {
      if (String(input).includes("api.example")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "New summary" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    });
    const imported = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({ ...samplePayload, sourceId: "plaud-summarize-tag", transcript: "body" }),
    });
    const { noteId } = await imported.json();
    const summarized = await fetch(`${h.base}/api/meetings/${encodeURIComponent(noteId)}/summarize`, {
      method: "POST",
      headers: sessionAuthz,
    });
    assert.equal(summarized.status, 200);
    const reimport = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({ ...samplePayload, sourceId: "plaud-summarize-tag", transcript: "body v2" }),
    });
    assert.equal(reimport.status, 200);
  } finally {
    await h.close();
  }
});

test("meetings content: oversized summary is capped to note budget", () => {
  const transcript = "x".repeat(120_000);
  assert.ok(Buffer.byteLength(finalizeMeetingNoteContent(SUMMARY_PENDING, transcript), "utf8") <= NOTE_BODY_MAX_BYTES);
  const content = finalizeMeetingNoteContent("y".repeat(90_000), transcript);
  assert.ok(Buffer.byteLength(content, "utf8") <= NOTE_BODY_MAX_BYTES);
  assert.match(content, /truncated to fit note size/);
});

test("meetings summarize: returns 409 when edited during LLM", async () => {
  const h = await harness({}, true);
  try {
    const originalFetch = globalThis.fetch;
    let unblock: () => void = () => {};
    const llmBlocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let importLlmDone = false;
    let summarizeLlmStarted = false;
    withMockLlmFetch(async (input, init) => {
      if (String(input).includes("api.example")) {
        if (!importLlmDone) {
          return new Response(JSON.stringify({ choices: [{ message: { content: "import summary" } }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        summarizeLlmStarted = true;
        await llmBlocked;
        return new Response(JSON.stringify({ choices: [{ message: { content: "Late summary text" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    });
    const imported = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({ ...samplePayload, sourceId: "plaud-race-summarize", transcript: "body for summarize race" }),
    });
    const { noteId } = await imported.json();
    importLlmDone = true;
    const summarizePromise = fetch(`${h.base}/api/meetings/${encodeURIComponent(noteId)}/summarize`, {
      method: "POST",
      headers: sessionAuthz,
    });
    while (!summarizeLlmStarted) await new Promise<void>((resolve) => setImmediate(resolve));
    const note = h.notes.getNote(noteId)!;
    const edited = await fetch(`${h.base}/api/knowledge/notes/${encodeURIComponent(noteId)}`, {
      method: "PUT",
      headers: sessionAuthz,
      body: JSON.stringify({ expectedVersion: note.version, content: `${note.content}\n\nRace edit kept.` }),
    });
    assert.equal(edited.status, 200);
    unblock();
    const summarized = await summarizePromise;
    assert.equal(summarized.status, 409);
    assert.match(h.notes.getNote(noteId)!.content, /Race edit kept/);
    assert.doesNotMatch(h.notes.getNote(noteId)!.content, /Late summary text/);
  } finally {
    await h.close();
  }
});

test("meetings summarize: does not clear edit guard after local edit", async () => {
  const h = await harness({}, true);
  try {
    const originalFetch = globalThis.fetch;
    withMockLlmFetch(async (input, init) => {
      if (String(input).includes("api.example")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "Summarized again" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    });
    const imported = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({ ...samplePayload, sourceId: "plaud-edit-summarize", transcript: "original" }),
    });
    const { noteId } = await imported.json();
    const note = h.notes.getNote(noteId)!;
    await h.notes.updateNote(noteId, { content: `${note.content}\n\nUser edit kept.`, expectedVersion: note.version ?? 0 });

    const summarized = await fetch(`${h.base}/api/meetings/${encodeURIComponent(noteId)}/summarize`, {
      method: "POST",
      headers: sessionAuthz,
    });
    assert.equal(summarized.status, 200);

    const reimport = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({ ...samplePayload, sourceId: "plaud-edit-summarize", transcript: "overwrite attempt" }),
    });
    assert.equal(reimport.status, 409);
    assert.match(h.notes.getNote(noteId)!.content, /User edit kept/);
    assert.doesNotMatch(h.notes.getNote(noteId)!.content, /overwrite attempt/);
  } finally {
    await h.close();
  }
});

test("meetings import: concurrent imports for same sourceId succeed once", async () => {
  const h = await harness();
  try {
    const originalFetch = globalThis.fetch;
    withMockLlmFetch(async (input, init) => {
      if (String(input).includes("api.example")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    });
    const body = JSON.stringify({ ...samplePayload, sourceId: "plaud-race", transcript: "concurrent line" });
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        fetch(`${h.base}/api/meetings/import`, { method: "POST", headers: importAuthz, body }),
      ),
    );
    for (const res of results) {
      assert.ok([200, 201].includes(res.status), `status ${res.status}`);
    }
    assert.equal(findMeetingNoteBySourceId(h.notes, "plaud-race")?.id, (await results[0]!.json()).noteId);
  } finally {
    await h.close();
  }
});

test("meetings import: re-import returns 409 after local edit", async () => {
  const h = await harness();
  try {
    const originalFetch = globalThis.fetch;
    withMockLlmFetch(async (input, init) => {
      if (String(input).includes("api.example")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "summary" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    });
    const first = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({ ...samplePayload, sourceId: "plaud-edit", transcript: "original" }),
    });
    const { noteId } = await first.json();
    const note = h.notes.getNote(noteId)!;
    await h.notes.updateNote(noteId, { content: `${note.content}\n\nUser notes here.`, expectedVersion: note.version ?? 0 });

    const second = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({ ...samplePayload, sourceId: "plaud-edit", transcript: "replacement" }),
    });
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error, "edited locally");
    assert.match(h.notes.getNote(noteId)!.content, /User notes here/);
  } finally {
    await h.close();
  }
});

test("meetings ask: citations include note links; sensitive meetings need opt-in", async () => {
  const h = await harness({}, true);
  try {
    const originalFetch = globalThis.fetch;
    withMockLlmFetch(async (input, init) => {
      if (String(input).includes("api.example")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "The codename is NEBULA [1]." } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    });

    const importRes = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: importAuthz,
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
      headers: sessionAuthz,
      body: JSON.stringify({ question: "What is the codename?" }),
    });
    assert.equal(without.status, 200);
    assert.doesNotMatch(prompt, /NEBULA/);

    const withMeetings = await fetch(`${h.base}/api/knowledge/ask`, {
      method: "POST",
      headers: sessionAuthz,
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

test("meetings ask: non-owner cannot opt into sensitive meetings", async () => {
  const h = await harness();
  try {
    const res = await fetch(`${h.base}/api/knowledge/ask`, {
      method: "POST",
      headers: sessionAuthz,
      body: JSON.stringify({ question: "Anything?", includeSensitiveMeetings: true }),
    });
    assert.equal(res.status, 403);
  } finally {
    await h.close();
  }
});

test("meetings import: does not log transcript content to console", async () => {
  const h = await harness();
  const secret = "ULTRA_SECRET_MEETING_LINE_QWERTY";
  const logs: string[] = [];
  const original = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.info = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    const originalFetch = globalThis.fetch;
    withMockLlmFetch(async (input, init) => {
      if (String(input).includes("api.example")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    });
    const res = await fetch(`${h.base}/api/meetings/import`, {
      method: "POST",
      headers: importAuthz,
      body: JSON.stringify({
        sourceId: "plaud-log-test",
        title: "Secret title",
        recordedAt: "2026-10-22T12:00:00.000Z",
        participants: ["Alice"],
        transcript: secret,
      }),
    });
    assert.equal(res.status, 201);
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
