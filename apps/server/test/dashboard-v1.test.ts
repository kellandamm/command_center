import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { SESSION_GAP_MS, buildSessions } from "../src/attention/sessions";
import { pickRediscover } from "../src/attention/rediscover";
import { composeAttentionSections } from "../src/attention/sections";
import { AttentionStore, snoozeUntil } from "../src/attention/store";
import { aggregateDailyCounts, buildHeatmapDays, heatmapDateRange } from "../src/heatmap/counts";
import { LaunchpadStore, validateLaunchpadUrl } from "../src/launchpad/store";
import { compareDashboardTasks, sortDashboardTasks } from "../src/tasks/sort";
import type { BoardCard } from "../src/board/types";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { normalizeDashboardLayout } from "../src/dashboard-layout/normalize";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { panels } from "../src/panels/registry";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const TOKEN = "d".repeat(32);
const OWNER_MSG =
  "Connection management requires a verified owner login. Set OWNER_EMAILS and sign in through Cloudflare Access; machine/admin tokens cannot manage keys.";

function card(partial: Partial<BoardCard> & Pick<BoardCard, "id" | "title">): BoardCard {
  return {
    notes: "",
    column: "Backlog",
    position: 1,
    hobieTaskId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    estimatedMinutes: null,
    dueDate: null,
    priority: "normal",
    version: 1,
    ...partial,
  };
}

test("tasks: sort order respects due date, blocks, priority, and created_at", () => {
  const cards = [
    card({ id: "a", title: "A", dueDate: "2026-10-25", priority: "low", createdAt: "2026-01-02T00:00:00.000Z" }),
    card({ id: "b", title: "B", dueDate: "2026-10-24", priority: "high", createdAt: "2026-01-03T00:00:00.000Z" }),
    card({ id: "c", title: "C", dueDate: null, priority: "high", createdAt: "2026-01-01T00:00:00.000Z" }),
    card({ id: "d", title: "D", dueDate: "2026-10-24", priority: "normal", createdAt: "2026-01-01T00:00:00.000Z" }),
  ];
  const blockStart = (id: string) => (id === "d" ? "2026-10-24T08:00:00.000Z" : id === "b" ? "2026-10-24T10:00:00.000Z" : null);
  const sorted = sortDashboardTasks(cards, blockStart, "all", "2026-10-24");
  assert.deepEqual(sorted.map((c) => c.id), ["d", "b", "a", "c"]);
  assert.ok(compareDashboardTasks(cards[1]!, cards[3]!, blockStart) > 0);
});

test("attention: sessions split at 45 minute boundary", () => {
  const events = [
    { at: "2026-10-24T10:00:00.000Z", kind: "note" as const, refId: "n1", title: "One" },
    { at: "2026-10-24T10:30:00.000Z", kind: "note" as const, refId: "n1", title: "One" },
    { at: "2026-10-24T11:30:00.000Z", kind: "card" as const, refId: "c1", title: "Card" },
  ];
  const sessions = buildSessions(events, SESSION_GAP_MS);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0]!.events.length, 2);
});

test("attention: dedupes items across sections and limits to three", () => {
  const sections = composeAttentionSections({
    todayYmd: "2026-10-24",
    tz: "UTC",
    nowMs: Date.parse("2026-10-24T12:00:00.000Z"),
    cards: [card({ id: "c1", title: "Due card", dueDate: "2026-10-23", column: "Backlog" })],
    notes: [{ id: "n1", title: "Note", content: "", tags: [], spaceId: null, sourceUrl: null, createdAt: "2025-10-24T00:00:00.000Z", updatedAt: "2026-10-24T10:00:00.000Z" }],
    sources: [],
    wins: [],
    timeline: [
      { at: "2026-10-24T10:00:00.000Z", kind: "note", refId: "n1", title: "Note" },
      { at: "2026-10-24T10:05:00.000Z", kind: "card", refId: "c1", title: "Due card" },
    ],
    pinned: [],
    hidden: new Set(),
    isSnoozed: () => false,
  });
  const dueIds = sections.find((s) => s.id === "due")!.items.map((i) => i.id);
  const continueIds = sections.find((s) => s.id === "continue")!.items.map((i) => i.id);
  assert.ok(dueIds.includes("card:c1"));
  assert.ok(!continueIds.includes("card:c1"));
  for (const section of sections) assert.ok(section.items.length <= 3);
});

test("attention: rediscover pick is stable for a day", () => {
  const candidates = Array.from({ length: 10 }, (_, i) => ({
    id: `note:n${i}`,
    title: `N${i}`,
    href: "/notes",
    untouchedDays: 100 + i,
  }));
  const a = pickRediscover(candidates, "2026-10-24", 3).map((c) => c.id);
  const b = pickRediscover(candidates, "2026-10-24", 3).map((c) => c.id);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, pickRediscover(candidates, "2026-10-25", 3).map((c) => c.id));
});

test("attention store: drops expired snoozes on load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-attn-"));
  try {
    const path = join(dir, "attention.json");
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = snoozeUntil("1w");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(path, JSON.stringify({ pinned: [], hidden: [], snoozed: { "note:1": past, "note:2": future } }), "utf8"),
    );
    const store = await AttentionStore.open(dir);
    assert.equal(store.isSnoozed("note:1"), false);
    assert.equal(store.isSnoozed("note:2"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("heatmap: aggregates counts per local day", () => {
  const { days } = heatmapDateRange(new Date("2026-10-24T15:00:00.000Z"));
  const counts = aggregateDailyCounts(
    ["2026-10-24T01:00:00.000Z", "2026-10-24T02:00:00.000Z", "2026-10-23T12:00:00.000Z"],
    "UTC",
    days,
  );
  const built = buildHeatmapDays(counts, days);
  const today = built.find((d) => d.date === "2026-10-24");
  assert.equal(today?.count, 2);
});

test("launchpad: rejects non-http URLs", () => {
  assert.throws(() => validateLaunchpadUrl("javascript:alert(1)"), /HTTP or HTTPS/);
  assert.equal(validateLaunchpadUrl("https://example.com/path"), "https://example.com/path");
});

test("dashboard v1 write routes require owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-dashv1-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "1" });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg),
    settings,
    dailyBriefing,
    notes,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-ah": "1" };
  try {
    for (const [path, body] of [
      ["/api/attention/pin", { id: "note:1", pinned: true }],
      ["/api/attention/snooze", { id: "note:1", until: "1d" }],
      ["/api/attention/hide", { id: "note:1", hidden: true }],
      ["/api/launchpad", { label: "Docs", url: "https://example.com" }],
      ["/api/dashboard-layout/import", { version: 2, cols: 12, rowHeight: 32, panels: [] }],
    ] as const) {
      const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.error, OWNER_MSG);
    }
    const layoutRes = await fetch(`${base}/api/dashboard-layout/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({ version: 99 }),
    });
    assert.equal(layoutRes.status, 403);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("dashboard layout import validates through normalize", () => {
  const ids = panels.map((p) => p.id);
  assert.throws(() => normalizeDashboardLayout(null, ids), /layout must be an object/);
  assert.throws(() => normalizeDashboardLayout({ version: 2, panels: "bad" }, ids), /panels must be an array/);
});

test("launchpad store persists links", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-launch-"));
  try {
    const store = await LaunchpadStore.open(dir);
    const link = await store.add({ label: "Docs", url: "https://example.com/docs" });
    const reopened = await LaunchpadStore.open(dir);
    assert.equal(reopened.list()[0]?.id, link.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
