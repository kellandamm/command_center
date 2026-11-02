import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeDashboardLayout } from "../src/dashboard-layout/normalize";
import { widgetIdsForSession } from "../src/dashboard-layout/widgets";
import { USAGE_READING_STALE_MS } from "../src/agents-usage/constants";
import { buildUsageDashboard } from "../src/agents-usage/view";
import type { UsageSnapshot } from "../src/agents-usage/types";

const WIDGET_IDS = widgetIdsForSession({ showBudget: true, showServiceStatus: true });

test("dashboard layout: agents-usage appends to saved layout without crashing", () => {
  const savedIds = WIDGET_IDS.filter((id) => id !== "agents-usage");
  const raw = {
    version: 3,
    widgets: savedIds.slice(0, 8).map((id) => ({ id, size: "W" as const })),
  };
  const next = normalizeDashboardLayout(raw, WIDGET_IDS, true, { appendMissing: true });
  assert.ok(next.widgets.find((w) => w.id === "agents-usage"));
});

test("dashboard layout: unknown panel ids in saved file are dropped safely", () => {
  const raw = {
    version: 2,
    cols: 12,
    rowHeight: 32,
    panels: [
      { id: "weather", x: 0, y: 0, w: 3, h: 3 },
      { id: "retired-panel", x: 3, y: 0, w: 3, h: 3 },
    ],
  };
  const next = normalizeDashboardLayout(raw, WIDGET_IDS, true, { appendMissing: true });
  assert.ok(!next.widgets.some((w) => w.id === "retired-panel"));
  assert.ok(next.widgets.find((w) => w.id === "weather"));
});

test("agents usage panel view: null weekly percent is unavailable not zero", () => {
  const snap: UsageSnapshot = {
    asOf: "2026-10-30T12:00:00.000Z",
    importedAt: "2026-10-30T12:00:00.000Z",
    weeklyPercentUsed: null,
    resetsAt: "2026-11-02T09:00:00.000Z",
    byBot: [],
    byRoutine: [],
    byDay: [],
  };
  const dash = buildUsageDashboard({ latestSnapshot: () => snap, listSnapshots: () => [snap], listCheckins: () => [], dailyLog: () => [] } as never, new Date("2026-10-30T13:00:00.000Z"));
  assert.equal(dash.computed.weeklyPercentUsed, null);
  assert.equal(dash.computed.metricsUnavailable, true);
});

test("agents usage panel view: stale reading flagged after 26h", () => {
  const asOf = "2026-10-28T10:00:00.000Z";
  const snap: UsageSnapshot = {
    asOf,
    importedAt: asOf,
    weeklyPercentUsed: 55,
    resetsAt: "2026-11-02T09:00:00.000Z",
    byBot: [{ name: "A", share: 10 }],
    byRoutine: [],
    byDay: [],
  };
  const now = new Date(new Date(asOf).getTime() + USAGE_READING_STALE_MS + 60_000);
  const dash = buildUsageDashboard({ latestSnapshot: () => snap, listSnapshots: () => [snap], listCheckins: () => [], dailyLog: () => [] } as never, now);
  assert.equal(dash.computed.readingStale, true);
  assert.ok(dash.computed.lastReadingAgeMs! > USAGE_READING_STALE_MS);
});

test("agents usage panel view: cycle ended after reset instant", () => {
  const snap: UsageSnapshot = {
    asOf: "2026-10-24T10:00:00.000Z",
    importedAt: "2026-10-24T10:00:00.000Z",
    weeklyPercentUsed: 80,
    resetsAt: "2026-10-24T09:00:00.000Z",
    byBot: [],
    byRoutine: [],
    byDay: [],
  };
  const dash = buildUsageDashboard({ latestSnapshot: () => snap, listSnapshots: () => [snap], listCheckins: () => [], dailyLog: () => [] } as never, new Date("2026-10-24T10:00:00.000Z"));
  assert.equal(dash.computed.cycleEnded, true);
  assert.match(dash.computed.cycleEndedMessage ?? "", /awaiting new reading/i);
});

test("agents usage panel view: null resetsAt yields reset unknown", () => {
  const snap: UsageSnapshot = {
    asOf: "2026-10-30T12:00:00.000Z",
    importedAt: "2026-10-30T12:00:00.000Z",
    weeklyPercentUsed: 12,
    resetsAt: null,
    byBot: [],
    byRoutine: [],
    byDay: [],
  };
  const dash = buildUsageDashboard({ latestSnapshot: () => snap, listSnapshots: () => [snap], listCheckins: () => [], dailyLog: () => [] } as never, new Date("2026-10-30T13:00:00.000Z"));
  assert.equal(dash.computed.resetsAt, null);
  assert.equal(dash.computed.metricsUnavailable, true);
});
