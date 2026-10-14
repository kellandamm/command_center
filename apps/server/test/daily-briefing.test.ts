import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { briefingDayPath, listBriefingDays, writeBriefingFile } from "../src/daily-briefing/storage";
import type { DailyBriefingRecord } from "../src/daily-briefing/types";

const emptySources = (): DailyBriefingRecord["sources"] => ({
  news: { status: "empty", data: { items: [], itemCount: 0 } },
  ai: { status: "not_configured", message: "LLM not configured" },
  todoist: { status: "not_configured", message: "Todoist is not configured" },
  weather: { status: "ok", data: { lat: 0, lon: 0, weather: { latitude: 0, longitude: 0, timezone: "UTC", current: { temperatureC: 0, weatherCode: 0, windKmh: 0, observedAt: null }, today: { highC: 0, lowC: 0, weatherCode: 0 }, label: "Clear" } } },
  calendar: { status: "not_configured", message: "Calendar is not configured" },
  github: { status: "empty", message: "No activity" },
});

test("daily briefing storage: per-day files list newest first", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-db-"));
  try {
    const rec = (day: string): DailyBriefingRecord => ({
      day,
      generatedAt: `${day}T12:00:00.000Z`,
      trigger: "manual",
      sources: emptySources(),
    });
    await writeBriefingFile(briefingDayPath(dir, "2026-10-12"), rec("2026-10-12"));
    await writeBriefingFile(briefingDayPath(dir, "2026-10-14"), rec("2026-10-14"));
    const days = await listBriefingDays(dir);
    assert.deepEqual(days, ["2026-10-14", "2026-10-12"]);
    assert.throws(() => briefingDayPath(dir, "not-a-day"), /invalid briefing day/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
