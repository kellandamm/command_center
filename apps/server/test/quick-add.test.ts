import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { CalendarWorkspace } from "../src/calendar/workspace";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { appendMarkerAfterLine, appendMarkerAfterLineScript } from "../src/notes/note-line-link";
import { OWNER_ACTION_FORBIDDEN } from "../src/owner-auth";
import { QUICK_ADD_COMMIT_OWNER_REQUIRED, commitItemError } from "../src/quick-add/errors";
import { ValidationError } from "../src/settings";
import { parseQuickAddText } from "../src/quick-add/parse";
import {
  eventPayloadFromItem,
  extractJsonObject,
  localMinuteToIso,
  normalizeQuickAddItem,
  parseQuickAddPayload,
  taskDueForTodoist,
} from "../src/quick-add/normalize";
import { commitQuickAddItems } from "../src/quick-add/commit";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const TOKEN = "q".repeat(32);

async function openHarness(
  env: Record<string, string> = {},
  auth?: ReturnType<typeof makeAuthenticator>,
) {
  const dir = await mkdtemp(join(tmpdir(), "cc-quick-add-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    ALLOW_INSECURE_NO_AUTH: "1",
    TZ: "America/Chicago",
    LLM_BASE_URL: "https://llm.example/v1",
    LLM_API_KEY: "key",
    LLM_MODEL: "model",
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
    auth: auth ?? makeAuthenticator(cfg),
    settings,
    dailyBriefing,
    notes,
    calendar,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-ah": "1" };
  const close = async () => {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, headers, cfg, calendar, notes, close };
}

test("quick-add normalize: accepts tasks and events with Chicago-local times", () => {
  const task = normalizeQuickAddItem({ kind: "task", title: "Call mom", due: "2026-10-26" });
  assert.equal(task.due, "2026-10-26");
  const event = normalizeQuickAddItem({
    kind: "event",
    title: "Standup",
    start: "2026-10-26T15:00:00.000Z",
    durationMinutes: 30,
  });
  assert.equal(event.durationMinutes, 30);
  assert.ok(event.end);
});

test("quick-add normalize: zone-less wall times map to Chicago under process TZ=UTC", () => {
  const cwd = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const run = spawnSync("pnpm", ["exec", "tsx", "test/quick-add-tz-utc.child.ts"], {
    cwd,
    env: { ...process.env, TZ: "UTC" },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("quick-add normalize: rejects malformed payloads", () => {
  assert.throws(() => parseQuickAddPayload({ items: [{ kind: "task", title: "" }] }), /title/i);
  assert.throws(() => parseQuickAddPayload({ items: [{ kind: "event", title: "X", due: "2026-10-26" }] }), /start\/end, not due/i);
  assert.throws(() => extractJsonObject("not json at all"), /JSON/i);
});

test("quick-add parse: uses stubbed LLM and America/Chicago context", async () => {
  const cfg = loadConfig({
    DATA_DIR: "/tmp/qa",
    LLM_BASE_URL: "https://llm.example/v1",
    LLM_API_KEY: "key",
    LLM_MODEL: "model",
    ALLOW_INSECURE_NO_AUTH: "1",
  });
  const fixedNow = new Date("2026-10-25T19:00:00.000Z");
  let seenUser = "";
  const items = await parseQuickAddText(cfg, "call mom tomorrow 3pm", {
    now: fixedNow,
    complete: async (_llm, messages) => {
      seenUser = messages.find((m) => m.role === "user")?.content ?? "";
      return JSON.stringify({
        items: [{ kind: "task", title: "Call mom", due: "2026-10-26T20:00:00.000Z" }],
      });
    },
  });
  assert.equal(items[0]?.title, "Call mom");
  assert.match(seenUser, /America\/Chicago/);
  assert.match(seenUser, /2026-10-25T19:00:00.000Z/);
});

test("quick-add parse route never writes to Todoist or calendar", async () => {
  const h = await openHarness();
  let todoistPosts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("api.todoist.com") && init?.method === "POST") todoistPosts++;
    if (url.includes("llm.example")) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ items: [{ kind: "task", title: "Dry run" }] }) } }],
      }), { status: 200 });
    }
    return originalFetch(input, init);
  };
  try {
    const beforeEvents = h.calendar.store.events().length;
    const res = await fetch(`${h.base}/api/quick-add/parse`, {
      method: "POST",
      headers: h.headers,
      body: JSON.stringify({ text: "dry run task" }),
    });
    assert.equal(res.status, 200);
    assert.equal(todoistPosts, 0);
    assert.equal(h.calendar.store.events().length, beforeEvents);
  } finally {
    globalThis.fetch = originalFetch;
    await h.close();
  }
});

test("quick-add commit: writes tasks and native events via stubs", async () => {
  const h = await openHarness();
  try {
    const calendar = await h.calendar.create({ kind: "native", name: "Personal" });
    let todoistBody = "";
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("api.todoist.com/api/v1/tasks") && !url.includes("/close")) {
        todoistBody = String(init?.body ?? "");
        return new Response(JSON.stringify({
          id: "td-1",
          content: "Call mom",
          description: "",
          priority: 1,
          due: null,
        }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const { results } = await commitQuickAddItems(h.cfg, h.calendar, [
      { kind: "task", title: "Call mom", due: "2026-10-26T15:00" },
      { kind: "event", title: "Lunch", start: "2026-10-26T12:00", end: "2026-10-26T13:00", calendarId: calendar.id },
    ], { fetchFn });
    assert.equal(results.length, 2);
    assert.match(results[0]!.url, /todoist/);
    assert.match(todoistBody, /due_datetime/);
    assert.equal(h.calendar.store.events().length, 1);
    const payload = eventPayloadFromItem(
      normalizeQuickAddItem({ kind: "event", title: "Lunch", start: "2026-10-26T12:00", end: "2026-10-26T13:00" }),
      calendar.id,
      "America/Chicago",
    );
    assert.equal(payload.localStart, "2026-10-26T12:00");
  } finally {
    await h.close();
  }
});

test("quick-add commit: partial success returns failures without duplicating successes", async () => {
  const h = await openHarness();
  try {
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({
          id: "td-1", content: "One", description: "", priority: 1, due: null, url: "https://todoist.com/showTask?id=td-1",
        }), { status: 200 });
      }
      return new Response("fail", { status: 500 });
    };
    const { results, failures } = await commitQuickAddItems(h.cfg, h.calendar, [
      { kind: "task", title: "One" },
      { kind: "task", title: "Two" },
    ], { fetchFn });
    assert.equal(results.length, 1);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.index, 1);
  } finally {
    await h.close();
  }
});

test("quick-add API: owner guard and configuration errors", async () => {
  const locked = await openHarness(
    { OWNER_EMAILS: "owner@example.com" },
    async () => ({ ok: true, who: "guest@example.com", owner: false }),
  );
  try {
    const denied = await fetch(`${locked.base}/api/quick-add/parse`, {
      method: "POST",
      headers: locked.headers,
      body: JSON.stringify({ text: "nope" }),
    });
    const body = await denied.json() as { error: string };
    assert.equal(denied.status, 403);
    assert.equal(body.error, OWNER_ACTION_FORBIDDEN);
  } finally {
    await locked.close();
  }

  const adminOnly = await openHarness({ OWNER_EMAILS: "owner@example.com" });
  try {
    const native = await adminOnly.calendar.create({ kind: "native", name: "Work" });
    const deniedCommit = await fetch(`${adminOnly.base}/api/quick-add/commit`, {
      method: "POST",
      headers: adminOnly.headers,
      body: JSON.stringify({ items: [{ kind: "event", title: "Blocked", start: "2026-10-26T12:00", end: "2026-10-26T13:00", calendarId: native.id }] }),
    });
    const commitBody = await deniedCommit.json() as { error: string };
    assert.equal(deniedCommit.status, 403);
    assert.equal(commitBody.error, QUICK_ADD_COMMIT_OWNER_REQUIRED);
  } finally {
    await adminOnly.close();
  }

  const noLlm = await openHarness({
    LLM_BASE_URL: "",
    LLM_API_KEY: "",
    LLM_MODEL: "",
  });
  try {
    const res = await fetch(`${noLlm.base}/api/quick-add/parse`, {
      method: "POST",
      headers: noLlm.headers,
      body: JSON.stringify({ text: "task" }),
    });
    assert.equal(res.status, 503);
  } finally {
    await noLlm.close();
  }

  const noTodoist = await openHarness(
    { TODOIST_API_TOKEN: "" },
    async () => ({ ok: true, who: "owner@example.com", owner: true }),
  );
  try {
    const res = await fetch(`${noTodoist.base}/api/quick-add/commit`, {
      method: "POST",
      headers: noTodoist.headers,
      body: JSON.stringify({ items: [{ kind: "task", title: "Only task" }] }),
    });
    assert.equal(res.status, 503);
  } finally {
    await noTodoist.close();
  }
});

test("quick-add note back-link: appendMarkerAfterLine leaves other lines unchanged", () => {
  const original = "Keep this line\nCall mom tomorrow\nFooter stays";
  const marker = "[task](https://todoist.com/showTask?id=1)";
  const updated = appendMarkerAfterLine(original, "Call mom tomorrow", marker);
  assert.equal(updated, "Keep this line\nCall mom tomorrow [task](https://todoist.com/showTask?id=1)\nFooter stays");
});

test("appendMarkerAfterLineScript matches the TypeScript implementation", () => {
  const run = new Function(`${appendMarkerAfterLineScript}; return appendMarkerAfterLine;`)() as typeof appendMarkerAfterLine;
  const original = "Alpha\nBeta line\nGamma";
  const marker = "[event](/calendar/events/1)";
  assert.equal(run(original, "Beta line", marker), appendMarkerAfterLine(original, "Beta line", marker));
});

test("commitItemError: passes through ValidationError messages", () => {
  assert.equal(commitItemError(new ValidationError("Choose a connected Google calendar")), "Choose a connected Google calendar");
});
