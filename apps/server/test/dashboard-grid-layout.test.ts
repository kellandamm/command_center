import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { DASHBOARD_GRID_LAYOUT_HELPERS } from "../src/ui/dashboard-grid-layout";

function runHelper<T>(body: string, context: Record<string, unknown> = {}): T {
  const sandbox: Record<string, unknown> = { ...context };
  vm.runInNewContext(`${DASHBOARD_GRID_LAYOUT_HELPERS}\n${body}`, sandbox);
  return sandbox.result as T;
}

test("dashboard grid layout: compactDashboardRows removes vertical gaps", () => {
  const panels = [
    { id: "calendar", x: 0, y: 0, w: 6, h: 5, collapsed: true },
    { id: "notes", x: 0, y: 5, w: 6, h: 3 },
  ];
  const compacted = runHelper<typeof panels>(`result = compactDashboardRows(panels);`, { panels });
  const notes = compacted.find((p) => p.id === "notes")!;
  assert.equal(notes.y, 1);
});

test("dashboard grid layout: columnPackLayout leaves no slack under collapsed panels", () => {
  const panels = [
    { id: "activity", x: 0, y: 6, w: 3, h: 2, collapsed: true },
    { id: "host-health", x: 0, y: 8, w: 3, h: 2, collapsed: true },
    { id: "weather", x: 9, y: 6, w: 3, h: 2 },
  ];
  const pack = runHelper<{ rects: Record<string, { top: number; height: number }> }>(
    `result = columnPackLayout(panels, 52, 6, 12, 30);`,
    { panels },
  );
  const activity = pack.rects.activity;
  const health = pack.rects["host-health"];
  assert.equal(activity.height, 30);
  const slack = health.top - (activity.top + activity.height);
  assert.ok(slack <= 6.5, `gap under collapsed should be grid gap only, got ${slack}px`);
});
