import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig, todoistConfigured } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";
import {
  completeTask,
  createTask,
  listTasks,
  partitionTodayAndOverdue,
  type TodoistTask,
} from "../src/todoist/client";

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

test("todoist: listTasks uses v1 URL, pagination, and field mapping", async () => {
  const calls: string[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("cursor=page2")) {
      return new Response(
        JSON.stringify({
          results: [{ id: "t2", content: "Second", description: "d", priority: 2, due: { date: "2026-10-15", string: "Oct 15" } }],
          next_cursor: null,
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        results: [
          {
            id: "t1",
            content: "First",
            description: "",
            priority: 4,
            due: { date: "2026-10-14", datetime: "2026-10-14T09:00:00Z", string: "today", timezone: "UTC" },
          },
        ],
        next_cursor: "page2",
      }),
      { status: 200 },
    );
  };
  const tasks = await listTasks("tok", fetchFn as typeof fetch);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^https:\/\/api\.todoist\.com\/api\/v1\/tasks\?limit=200$/);
  assert.match(calls[1], /cursor=page2/);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].id, "t1");
  assert.equal(tasks[0].priority, 4);
  assert.equal(tasks[0].due?.datetime, "2026-10-14T09:00:00Z");
  assert.equal(tasks[0].url, "https://app.todoist.com/app/task/t1");
  assert.equal(tasks[1].content, "Second");
});

test("todoist: createTask and completeTask hit v1 endpoints", async () => {
  const urls: Array<{ url: string; method?: string }> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push({ url, method: init?.method });
    if (url.endsWith("/tasks") && init?.method === "POST") {
      return new Response(
        JSON.stringify({ id: "new1", content: "Inbox task", description: "", priority: 1, due: null }),
        { status: 200 },
      );
    }
    if (url.includes("/tasks/new1/close")) {
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  };
  const created = await createTask("tok", "Inbox task", fetchFn as typeof fetch);
  assert.equal(created.id, "new1");
  assert.equal(created.url, "https://app.todoist.com/app/task/new1");
  assert.match(urls[0].url, /^https:\/\/api\.todoist\.com\/api\/v1\/tasks$/);
  await completeTask("tok", "new1", fetchFn as typeof fetch);
  assert.match(urls[1].url, /^https:\/\/api\.todoist\.com\/api\/v1\/tasks\/new1\/close$/);
  assert.equal(urls[1].method, "POST");
});

test("todoist: partition overdue and today by configured zone", () => {
  const now = new Date("2026-10-14T15:00:00Z");
  const tz = "UTC";
  const { overdue, today } = partitionTodayAndOverdue(
    [task("1", "old", "2026-10-13"), task("2", "now", "2026-10-14"), task("3", "later", "2026-10-15"), task("4", "nodue", null)],
    now,
    tz,
  );
  assert.deepEqual(overdue.map((t) => t.id), ["1"]);
  assert.deepEqual(today.map((t) => t.id), ["2"]);
});

test("todoist: dashboard API removed; MCP client helpers still work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "1" });
  assert.equal(todoistConfigured(cfg), false);
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({ cfg, auth: makeAuthenticator(cfg), settings, dailyBriefing, notes, ...integration });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const r = await fetch(`${base}/api/todoist`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(r.status, 404);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
