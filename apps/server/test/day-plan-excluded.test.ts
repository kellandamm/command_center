import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DayPlanStore } from "../src/day-plan/store";
import { buildDeterministicPlan } from "../src/day-plan/planner";

test("day-plan store: persists must-dos and capacity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-day-plan-store-"));
  try {
    const store = DayPlanStore.open(dir);
    const plan = buildDeterministicPlan({
      context: { day: "2026-07-01", tz: "UTC", occurrences: [], tasks: [], allDayLabels: [] },
      now: new Date("2026-07-01T12:00:00Z"),
      weekendOverride: true,
    });
    store.save(plan);
    const loaded = store.load("2026-07-01");
    assert.equal(loaded?.day, "2026-07-01");
    assert.equal(loaded?.capacity.availableMinutes, 480);
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("day-plan excluded: no budget subscriptions vault imports", () => {
  const root = join(process.cwd(), "src/day-plan");
  for (const file of ["gather.ts", "planner.ts", "capacity.ts", "service.ts", "store.ts"]) {
    const src = readFileSync(join(root, file), "utf8");
    assert.ok(!src.includes("budget/"));
    assert.ok(!src.includes("BudgetStore"));
    assert.ok(!src.includes("subscriptions"));
    assert.ok(!src.includes("home-vault"));
  }
});
