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
import { CalendarWorkspace } from "../src/calendar/workspace";
import { createTestCfAccessJwt, TEST_CF_AUD, TEST_CF_TEAM } from "./cf-access-jwt";
import type { BoardStore } from "../src/board/store";
import { DONE } from "../src/board/types";
import { planTestMonday, PLAN_TEST_TZ } from "./day-plan-relative-days";
import { dayKey } from "../src/store";

const TOKEN = "t".repeat(32);
const SECRET_TITLE = "SECRET_MUST_DO_TITLE_XYZ";

async function ownerHarness(boardSeed?: (board: BoardStore) => void) {
  const keys = await createTestCfAccessJwt();
  const dir = await mkdtemp(join(tmpdir(), "cc-dp-mustdo-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    TZ: PLAN_TEST_TZ,
    OWNER_EMAILS: "owner@example.com",
    CF_ACCESS_TEAM_DOMAIN: TEST_CF_TEAM,
    CF_ACCESS_AUD: TEST_CF_AUD,
    TODOIST_API_TOKEN: "todoist-test-token",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  if (boardSeed) boardSeed(integration.board);
  const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board: integration.board });
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, keys.verifier),
    settings,
    dailyBriefing,
    notes,
    calendar,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ownerJwt = await keys.signEmailJwt("owner@example.com");
  const owner = { "cf-access-jwt-assertion": ownerJwt, "x-ah": "1" };
  const ui = { ...owner, "x-day-plan-ui": "1" };
  const call = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const close = async () => {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { call, close, ui, owner, integration, keys };
}

test("day-plan must-do: board complete and reopen are owner UI-click only", async () => {
  const MON = planTestMonday();
  let cardId = "";
  const logs: string[] = [];
  const origErr = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  const h = await ownerHarness((board) => {
    cardId = board.create({ title: SECRET_TITLE, dueDate: MON, estimatedMinutes: 45 }).id;
  });
  try {
    assert.equal((await h.call("GET", `/api/day-plan?day=${MON}`, h.owner)).status, 200);
    const plan = (await (await h.call("GET", `/api/day-plan?day=${MON}`, h.owner)).json()) as {
      plan: { mustDos: Array<{ slot: number; refId: string }> };
    };
    const slot = plan.plan.mustDos.find((m) => m.refId === cardId)?.slot;
    assert.equal(typeof slot, "number");

    assert.equal(
      (await h.call("POST", "/api/day-plan/must-do/complete", { authorization: `Bearer ${TOKEN}`, "x-ah": "1", "x-day-plan-ui": "1" }, { day: MON, slot })).status,
      403,
    );
    const visitorJwt = await h.keys.signEmailJwt("visitor@example.com");
    assert.equal(
      (await h.call("POST", "/api/day-plan/must-do/complete", { "cf-access-jwt-assertion": visitorJwt, "x-ah": "1", "x-day-plan-ui": "1" }, { day: MON, slot })).status,
      403,
    );
    assert.equal(
      (await h.call("POST", "/api/day-plan/must-do/complete", h.owner, { day: MON, slot })).status,
      403,
    );

    assert.equal((await h.call("POST", "/api/day-plan/must-do/complete", h.ui, { day: MON, slot })).status, 200);
    assert.equal(h.integration.board.get(cardId)?.column, DONE);
    assert.ok(logs.every((line) => !line.includes(SECRET_TITLE)));

    assert.equal((await h.call("POST", "/api/day-plan/must-do/complete", h.ui, { day: MON, slot })).status, 200);
    assert.equal((await h.call("POST", "/api/day-plan/must-do/reopen", h.ui, { day: MON, slot })).status, 200);
    assert.notEqual(h.integration.board.get(cardId)?.column, DONE);
  } finally {
    console.error = origErr;
    await h.close();
  }
});

test("day-plan must-do: todoist complete hits close endpoint", async () => {
  const MON = dayKey(new Date(), PLAN_TEST_TZ);
  const calls: string[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/api/v1/tasks?") && (!init?.method || init.method === "GET")) {
      return new Response(
        JSON.stringify({
          results: [{ id: "td1", content: SECRET_TITLE, description: "", priority: 4, due: { date: MON } }],
          next_cursor: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/tasks/td1/close")) return new Response(null, { status: 204 });
    return origFetch(input, init);
  }) as typeof fetch;
  const h = await ownerHarness();
  try {
    assert.equal((await h.call("POST", "/api/day-plan/generate", h.ui, { day: MON })).status, 200);
    const plan = (await (await h.call("GET", `/api/day-plan?day=${MON}`, h.ui)).json()) as {
      plan: { mustDos: Array<{ slot: number; source: string; refId: string; completedAt: string | null }> };
    };
    const todo = plan.plan.mustDos.find((m) => m.source === "todoist" && m.refId === "td1");
    assert.ok(todo);
    assert.equal((await h.call("POST", "/api/day-plan/must-do/complete", h.ui, { day: MON, slot: todo!.slot })).status, 200);
    assert.ok(calls.some((c) => c.includes("/tasks/td1/close")));
    const after = (await (await h.call("GET", `/api/day-plan?day=${MON}`, h.ui)).json()) as {
      plan: { mustDos: Array<{ slot: number; completedAt: string | null }> };
    };
    assert.ok(after.plan.mustDos.find((m) => m.slot === todo!.slot)?.completedAt);
  } finally {
    globalThis.fetch = origFetch;
    await h.close();
  }
});

test("day-plan must-do: remote failure leaves local must-do open", async () => {
  const MON = planTestMonday();
  let cardId = "";
  const h = await ownerHarness((board) => {
    cardId = board.create({ title: "Fragile", dueDate: MON, estimatedMinutes: 20 }).id;
  });
  try {
    await h.call("GET", `/api/day-plan?day=${MON}`, h.owner);
    const slot = (
      (await (await h.call("GET", `/api/day-plan?day=${MON}`, h.owner)).json()) as {
        plan: { mustDos: Array<{ slot: number; refId: string }> };
      }
    ).plan.mustDos.find((m) => m.refId === cardId)!.slot;
    const move = h.integration.board.move.bind(h.integration.board);
    h.integration.board.move = async () => undefined;
    const res = await h.call("POST", "/api/day-plan/must-do/complete", h.ui, { day: MON, slot });
    assert.equal(res.status, 502);
    h.integration.board.move = move;
    assert.equal(h.integration.dayPlan.load(MON)?.mustDos.find((m) => m.slot === slot)?.completedAt, null);
  } finally {
    await h.close();
  }
});
