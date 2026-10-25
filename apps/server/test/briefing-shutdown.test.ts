import { test } from "node:test";
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
import {
  buildShutdownReview,
  completedOnChicagoDay,
  dayRangeIso,
  generateShutdownReflection,
  SHUTDOWN_TZ,
} from "../src/briefing/shutdown-service";
import { dayKey } from "../src/store";
import { slotInstant } from "../src/scheduler";
import { CalendarWorkspace } from "../src/calendar/workspace";
import { DONE } from "../src/board/types";
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "./cf-access-jwt";
import type { TodoistCompletedTask, TodoistTask } from "../src/todoist/client";
const TOKEN = "t".repeat(32);

function task(id: string, content: string, dueDate: string | null, priority = 1): TodoistTask {
  return {
    id,
    content,
    description: "",
    priority,
    due: dueDate ? { date: dueDate, string: dueDate, datetime: null } : null,
    url: "https://todoist.com/showTask?id=" + id,
  };
}

async function harness(
  env: Record<string, string> = {},
  owner = false,
  verifyJwt?: (token: string) => Promise<import("jose").JWTPayload>,
) {
  const dir = await mkdtemp(join(tmpdir(), "cc-shutdown-"));
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
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board: integration.board });
  const server = createApp({
    cfg,
    auth: owner
      ? async () => ({ ok: true, who: "owner@example.com", owner: true, email: "owner@example.com" })
      : makeAuthenticator(cfg, verifyJwt),
    settings,
    dailyBriefing,
    notes,
    calendar,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, close, cfg, board: integration.board, calendar };
}

const authz = { authorization: `Bearer ${TOKEN}`, "x-ah": "1" };

test("shutdown: Chicago completion day boundaries under TZ=UTC", () => {
  const day = "2026-10-14";
  assert.equal(completedOnChicagoDay("2026-10-15T04:30:00.000Z", day), true);
  assert.equal(completedOnChicagoDay("2026-10-15T05:30:00.000Z", day), false);
  const range = dayRangeIso(day, SHUTDOWN_TZ);
  assert.equal(range.since, "2026-10-14T05:00:00.000Z");
  assert.equal(range.until, "2026-10-15T05:00:00.000Z");
});

test("shutdown: aggregates stubbed Todoist, board done moves, and blocked cards", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-shutdown-agg-"));
  try {
    const cfg = loadConfig({
      DATA_DIR: dir,
      ALLOW_INSECURE_NO_AUTH: "1",
      TZ: "UTC",
      TODOIST_API_TOKEN: "todoist-test-token",
    });
    const notes = await NotesStore.open(dir);
    const integration = await openIntegrationStores(dir, cfg);
    const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board: integration.board });
    const now = new Date();
    const day = dayKey(now, SHUTDOWN_TZ);
    const tomorrow = new Date(`${day}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    const yesterday = new Date(`${day}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayKey = yesterday.toISOString().slice(0, 10);

    const card = integration.board.create({ title: "Ship shutdown", column: "Backlog" });
    await integration.board.move(card.id, DONE);
    const openCard = integration.board.create({ title: "Blocked task", column: "Backlog" });
    const cal = await calendar.create({ kind: "native", name: "Plan", color: "#336699", enabled: true });
    await calendar.saveEvent({
      calendarId: cal.id,
      summary: "Focus block",
      allDay: false,
      timezone: SHUTDOWN_TZ,
      localStart: `${day}T10:00`,
      durationMinutes: 60,
      taskId: openCard.id,
      expectedTaskVersion: openCard.version,
    });

    const completed: TodoistCompletedTask[] = [
      { id: "c1", content: "Done late", completedAt: slotInstant(day, "23:30", SHUTDOWN_TZ).toISOString() },
      { id: "c2", content: "Tomorrow", completedAt: slotInstant(tomorrowKey, "00:30", SHUTDOWN_TZ).toISOString() },
    ];
    const open: TodoistTask[] = [
      task("t1", "Overdue", yesterdayKey),
      task("t2", "Today open", day),
      task("t3", "Tomorrow due", tomorrowKey),
    ];
    let listCalls = 0;
    const review = await buildShutdownReview({
      cfg,
      board: integration.board,
      calendar,
      now,
      listCompleted: async () => completed,
      fetchFn: async (input) => {
        if (String(input).includes("/tasks")) {
          listCalls++;
          return new Response(JSON.stringify(open), { headers: { "content-type": "application/json" } });
        }
        return new Response("{}", { status: 404 });
      },
    });

    assert.deepEqual(review.done.todoist.map((t) => t.id), ["c1"]);
    assert.equal(review.done.board.length, 1);
    assert.equal(review.unfinished.todoist.overdue.length, 1);
    assert.equal(review.unfinished.todoist.today.length, 1);
    assert.equal(review.unfinished.blockedToday.length, 1);
    assert.equal(review.tomorrowPreview.tasksDue.length, 1);
    assert.equal(listCalls, 1);
    integration.board.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shutdown: reflection only when POST is called", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-shutdown-llm-"));
  try {
    const cfg = loadConfig({
      DATA_DIR: dir,
      ALLOW_INSECURE_NO_AUTH: "1",
      TZ: "UTC",
      LLM_BASE_URL: "https://api.example/v1",
      LLM_API_KEY: "sk-test",
      LLM_MODEL: "test-model",
    });
    const integration = await openIntegrationStores(dir, cfg);
    const notes = await NotesStore.open(dir);
    const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board: integration.board });
    const now = new Date("2026-10-14T12:00:00Z");
    const review = await buildShutdownReview({
      cfg,
      board: integration.board,
      calendar,
      now,
      listCompleted: async () => [],
      fetchFn: async () => new Response("[]", { headers: { "content-type": "application/json" } }),
    });
    assert.equal(review.llmEnabled, true);
    let llmCalls = 0;
    const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/chat/completions")) {
        llmCalls++;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "You closed the loop on the essentials." } }] }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response("[]", { headers: { "content-type": "application/json" } });
    };
    await buildShutdownReview({
      cfg,
      board: integration.board,
      calendar,
      now,
      listCompleted: async () => [],
      fetchFn,
    });
    assert.equal(llmCalls, 0);

    const reflection = await generateShutdownReflection(review, cfg, async (input, init) => {
      if (String(input).includes("/chat/completions")) {
        llmCalls++;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "You closed the loop on the essentials." } }] }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return fetchFn(input, init);
    });
    assert.equal(reflection, "You closed the loop on the essentials.");
    assert.equal(llmCalls, 1);
    assert.equal(review.llmEnabled, true);
    integration.board.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shutdown API: auth guard for owner or canManage", async () => {
  const keys = await createTestCfAccessJwt();
  const locked = await harness(
    { OWNER_EMAILS: "owner@example.com", CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM, CF_ACCESS_AUD: TEST_CF_AUD },
    false,
    keys.verifier,
  );
  try {
    const visitorJwt = await keys.signEmailJwt("visitor@example.com");
    const visitorHeaders = { "cf-access-jwt-assertion": visitorJwt, "x-ah": "1" };
    const denied = await fetch(`${locked.base}/api/briefing/shutdown`, { headers: visitorHeaders });
    assert.equal(denied.status, 403);
    const deniedReflect = await fetch(`${locked.base}/api/briefing/shutdown/reflection`, {
      method: "POST",
      headers: visitorHeaders,
      body: "{}",
    });
    assert.equal(deniedReflect.status, 403);
    const adminOk = await fetch(`${locked.base}/api/briefing/shutdown`, { headers: authz });
    assert.equal(adminOk.status, 200);
  } finally {
    await locked.close();
  }

  const ownerHarness = await harness({ OWNER_EMAILS: "owner@example.com" }, true);
  try {
    const ok = await fetch(`${ownerHarness.base}/api/briefing/shutdown`, {
      headers: { "x-ah": "1" },
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.review.zone, SHUTDOWN_TZ);
    assert.match(body.review.day, /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    await ownerHarness.close();
  }
});
