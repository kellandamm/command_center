import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { SettingsStore } from "../src/settings";
import { NotesStore } from "../src/notes/store";
import { BudgetStore } from "../src/budget/store";
import { BookmarksStore } from "../src/bookmarks/store";
import { BoardStore } from "../src/board/store";
import { SERVICE_WORKER } from "../src/pwa";
import {
  MAX_QUERY_LENGTH,
  paletteBudgetRowsAllowed,
  scoreTextMatch,
  searchCommandPalette,
} from "../src/command-palette/search";
import { TodoistOpenTaskCache, TODOIST_OPEN_TASKS_TTL_MS } from "../src/command-palette/todoist-cache";
import { isBudgetOwner } from "../src/budget/owner-access";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const OWNER = "owner@example.com";
const ownerHeaders = { cookie: "CF_Authorization=t", "x-ah": "1" };

test("command palette: scoreTextMatch ranks prefix matches higher", () => {
  assert.ok(scoreTextMatch("Dashboard home", "dash") > scoreTextMatch("My dashboard", "dash"));
  assert.equal(scoreTextMatch("nothing", "xyz"), -1);
});

test("command palette: sensitive note body not searchable; catalog redacts content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-cp-redact-"));
  const notes = await NotesStore.open(dir);
  await notes.createNote({ title: "Public", content: "FINDME_PUBLIC" });
  await notes.createNote({ title: "Secret title", content: "FINDME_SECRET_BODY", sensitive: true });
  const settings = new SettingsStore(dir);
  await settings.load();
  const hits = await searchCommandPalette({
    query: "FINDME_SECRET_BODY",
    notes,
    bookmarks: await BookmarksStore.open(dir),
    board: BoardStore.open(dir),
    cfg: loadConfig({ DATA_DIR: dir, TZ: "UTC" }),
    settings,
    who: { ok: true, owner: true, email: OWNER, who: OWNER, serviceToken: false },
    todoistCache: new TodoistOpenTaskCache(loadConfig({ DATA_DIR: dir })),
  });
  assert.ok(!hits.some((r) => r.title === "Secret title"));
  const catalog = notes.listNotes("Secret", true);
  assert.ok(catalog.every((n) => !n.content.includes("FINDME_SECRET_BODY")));
  await rm(dir, { recursive: true, force: true });
});

test("command palette: revert guard — budget rows omitted unless owner gate passes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-cp-budget-guard-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    CF_ACCESS_TEAM_DOMAIN: "team.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: OWNER,
    TZ: "UTC",
  });
  const budget = BudgetStore.open(dir);
  const acct = budget.createAccount({ name: "Checking", type: "checking" });
  budget.commitImport({
    accountId: acct.id,
    fileName: "x.csv",
    fileSha256: "sha",
    mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD", amountColumn: "Amount" },
    invertSign: false,
    rows: [
      {
        rowNumber: 2,
        date: "2026-01-01",
        amountCents: -100,
        payee: "UNIQUE_PAYEE_XYZ",
        memo: "",
        categoryId: null,
        fingerprint: "fp1",
      },
    ],
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const whoNonOwner = { ok: true as const, owner: false, email: "other@example.com", who: "other@example.com", serviceToken: false };
  assert.equal(paletteBudgetRowsAllowed(cfg, whoNonOwner), false);
  const filtered = await searchCommandPalette({
    query: "UNIQUE_PAYEE",
    cfg,
    settings,
    notes: await NotesStore.open(dir),
    bookmarks: await BookmarksStore.open(dir),
    board: BoardStore.open(dir),
    budget,
    who: whoNonOwner,
    todoistCache: new TodoistOpenTaskCache(cfg),
  });
  assert.ok(!filtered.some((r) => r.type === "budget-tx"));
  const unfilteredSim = await searchCommandPalette({
    query: "UNIQUE_PAYEE",
    cfg,
    settings,
    notes: await NotesStore.open(dir),
    bookmarks: await BookmarksStore.open(dir),
    board: BoardStore.open(dir),
    budget,
    who: whoNonOwner,
    todoistCache: new TodoistOpenTaskCache(cfg),
    testIncludeBudgetWithoutOwner: true,
  });
  assert.ok(unfilteredSim.some((r) => r.type === "budget-tx"), "guard blocks budget; removing filter would expose rows");
  budget.close();
  await rm(dir, { recursive: true, force: true });
});

test("command palette: isBudgetOwner matches budget route gate", () => {
  assert.equal(isBudgetOwner({ ok: true, owner: true, email: OWNER, who: OWNER, serviceToken: false }), true);
  assert.equal(isBudgetOwner({ ok: true, owner: true, email: undefined, who: "svc", serviceToken: true }), false);
});

test("command palette: API omits budget for non-owner; budget API still 403", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-cp-api-owner-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: "1",
    CF_ACCESS_TEAM_DOMAIN: "team.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: OWNER,
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const budget = BudgetStore.open(dir);
  const acct = budget.createAccount({ name: "Checking", type: "checking" });
  budget.commitImport({
    accountId: acct.id,
    fileName: "x.csv",
    fileSha256: "sha",
    mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD", amountColumn: "Amount" },
    invertSign: false,
    rows: [
      {
        rowNumber: 2,
        date: "2026-01-01",
        amountCents: -50,
        payee: "PALETTE_PAYEE_Q",
        memo: "",
        categoryId: null,
        fingerprint: "fp2",
      },
    ],
  });
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async () => ({ email: "viewer@example.com" })),
    settings,
    dailyBriefing: await DailyBriefingService.open(dir, cfg.tz),
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const search = await fetch(`${base}/api/command-palette/search?q=PALETTE_PAYEE`, { headers: ownerHeaders });
    assert.equal(search.status, 200);
    const body = (await search.json()) as { results: Array<{ type: string; title: string }> };
    assert.ok(!body.results.some((r) => r.type === "budget-tx"));
    assert.ok(!body.results.some((r) => r.title === "Budget"));
    const budgetApi = await fetch(`${base}/api/budget/accounts`, { headers: ownerHeaders });
    assert.equal(budgetApi.status, 403);
  } finally {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("command palette: search JSON is never cached in PWA (/api/ bypass)", () => {
  assert.match(SERVICE_WORKER, /pathname\.startsWith\("\/api\/"\)/);
});

test("command palette: Cache-Control no-store on search API", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-cp-cache-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: "1",
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async () => ({ email: OWNER })),
    settings,
    dailyBriefing: await DailyBriefingService.open(dir, cfg.tz),
    notes,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/command-palette/search?q=`, { headers: ownerHeaders });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/i);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("command palette: Todoist fetch failure returns 200 without task rows and backs off refetch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-cp-todoist-fail-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    TODOIST_API_TOKEN: "tok",
    TZ: "UTC",
  });
  let calls = 0;
  const fetchFn: typeof fetch = async () => {
    calls++;
    return new Response("upstream down", { status: 503 });
  };
  const cache = new TodoistOpenTaskCache(cfg, fetchFn);
  const settings = new SettingsStore(dir);
  await settings.load();
  const notes = await NotesStore.open(dir);
  await notes.createNote({ title: "StillFindMe", content: "body" });
  const board = BoardStore.open(dir);
  const bookmarks = await BookmarksStore.open(dir);
  const deps = {
    cfg,
    settings,
    notes,
    bookmarks,
    board,
    who: { ok: true as const, owner: true, email: OWNER, who: OWNER, serviceToken: false },
    todoistCache: cache,
  };
  const first = await searchCommandPalette({ ...deps, query: "StillFind" });
  assert.ok(first.some((r) => r.type === "note"));
  assert.ok(!first.some((r) => r.type === "task"));
  await searchCommandPalette({ ...deps, query: "StillFind" });
  await searchCommandPalette({ ...deps, query: "Other" });
  await searchCommandPalette({ ...deps, query: "Third" });
  assert.equal(calls, 1);
  board.close();
  await rm(dir, { recursive: true, force: true });
});

test("command palette: API trims q before 200-character cap", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-cp-q-trim-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: "1",
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const notes = await NotesStore.open(dir);
  const title = "Z".repeat(MAX_QUERY_LENGTH);
  await notes.createNote({ title, content: "trim-cap seed" });
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async () => ({ email: OWNER })),
    settings,
    dailyBriefing: await DailyBriefingService.open(dir, cfg.tz),
    notes,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const padded = `  ${"Z".repeat(MAX_QUERY_LENGTH)}  `;
    assert.ok(padded.length > MAX_QUERY_LENGTH);
    const res = await fetch(`${base}/api/command-palette/search?q=${encodeURIComponent(padded)}`, {
      headers: ownerHeaders,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { results: Array<{ title: string; type: string }> };
    assert.ok(body.results.some((r) => r.type === "note" && r.title === title));
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("command palette: API truncates q to 200 characters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-cp-q-cap-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: "1",
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const notes = await NotesStore.open(dir);
  const needle = "Z".repeat(MAX_QUERY_LENGTH + 50);
  await notes.createNote({ title: `${"Z".repeat(MAX_QUERY_LENGTH)}UniqueTail`, content: "x" });
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async () => ({ email: OWNER })),
    settings,
    dailyBriefing: await DailyBriefingService.open(dir, cfg.tz),
    notes,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/command-palette/search?q=${encodeURIComponent(needle)}`, {
      headers: ownerHeaders,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { results: Array<{ title: string }> };
    assert.ok(body.results.some((r) => r.title.includes("UniqueTail")));
    const head = await fetch(`${base}/api/command-palette/search?q=`, { method: "HEAD", headers: ownerHeaders });
    assert.equal(head.status, 200);
    assert.match(head.headers.get("x-content-type-options") ?? "", /nosniff/i);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("command palette: Todoist listTasks cached for 60s", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-cp-todoist-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    TODOIST_API_TOKEN: "tok",
    TZ: "UTC",
  });
  let calls = 0;
  const fetchFn: typeof fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ results: [{ id: "1", content: "Alpha task", description: "" }], next_cursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const cache = new TodoistOpenTaskCache(cfg, fetchFn);
  const settings = new SettingsStore(dir);
  await settings.load();
  const notes = await NotesStore.open(dir);
  const board = BoardStore.open(dir);
  const bookmarks = await BookmarksStore.open(dir);
  const deps = {
    cfg,
    settings,
    notes,
    bookmarks,
    board,
    who: { ok: true as const, owner: true, email: OWNER, who: OWNER, serviceToken: false },
    todoistCache: cache,
  };
  await searchCommandPalette({ ...deps, query: "Alpha" });
  await searchCommandPalette({ ...deps, query: "Alpha" });
  assert.equal(calls, 1);
  assert.equal(TODOIST_OPEN_TASKS_TTL_MS, 60_000);
  board.close();
  await rm(dir, { recursive: true, force: true });
});
