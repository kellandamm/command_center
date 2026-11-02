import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DayPlanStore } from "../src/day-plan/store";
import { buildDeterministicPlan } from "../src/day-plan/planner";
import { DAY_PLAN_FORBIDDEN_IMPORT_SUBSTRINGS } from "../src/day-plan/excluded";

const emptySources = { calendarUnavailable: false, todoistUnavailable: false };

test("day-plan store: persists must-dos and capacity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-day-plan-store-"));
  try {
    const store = DayPlanStore.open(dir);
    const plan = buildDeterministicPlan({
      context: { day: "2026-07-01", tz: "UTC", occurrences: [], tasks: [], allDayLabels: [], sources: emptySources },
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

test("day-plan excluded: scan all files under day-plan/", () => {
  const root = join(process.cwd(), "src/day-plan");
  for (const file of readdirSync(root)) {
    if (!file.endsWith(".ts") || file === "excluded.ts") continue;
    const src = readFileSync(join(root, file), "utf8");
    for (const needle of DAY_PLAN_FORBIDDEN_IMPORT_SUBSTRINGS) {
      assert.ok(!src.includes(needle), `${file} must not reference ${needle}`);
    }
  }
});
