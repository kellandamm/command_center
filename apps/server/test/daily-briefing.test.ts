import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { briefingDayPath, listBriefingDays, readBriefingFile, writeBriefingFile } from "../src/daily-briefing/storage";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { Scheduler, type KVLike } from "../src/scheduler";
import type { DailyBriefingRecord } from "../src/daily-briefing/types";

const emptySources = (): DailyBriefingRecord["sources"] => ({
  todoist: { status: "not_configured", message: "Todoist is not configured" },
  weather: { status: "ok", data: { lat: 0, lon: 0, weather: { latitude: 0, longitude: 0, timezone: "UTC", current: { temperatureC: 0, weatherCode: 0, windKmh: 0, observedAt: null }, today: { highC: 0, lowC: 0, weatherCode: 0 }, label: "Clear" } } },
  calendar: { status: "not_configured", message: "Calendar is not configured" },
  github: { status: "empty", message: "No activity" },
  board: { status: "empty", data: { blocked: [], moved: [], wins: [] } },
});

test("daily briefing: legacy archives omit retired sources without rewriting user data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-legacy-briefing-"));
  try {
    const path = briefingDayPath(dir, "2026-10-14");
    const legacy = JSON.stringify({
      day: "2026-10-14", generatedAt: "2026-10-14T12:00:00Z", trigger: "schedule",
      sources: { ...emptySources(), news: { status: "ok", data: { items: [{ title: "retired article" }] } },
        ai: { status: "ok", data: { content: "retired summary" } } },
    });

    test("daily briefing: generation stores only personal sources without news or LLM requests", async () => {
      const dir = await mkdtemp(join(tmpdir(), "cc-personal-briefing-"));
      try {
        const cfg = loadConfig({
          ADMIN_TOKEN: "t".repeat(32), DATA_DIR: dir, TZ: "UTC",
          LLM_BASE_URL: "https://unused.example/v1", LLM_API_KEY: "unused", LLM_MODEL: "unused",
        });
        const calls: string[] = [];
        const fetchFn: typeof fetch = async (input) => {
          calls.push(String(input));
          assert.equal(new URL(String(input)).hostname, "api.open-meteo.com");
          return new Response(JSON.stringify({ current: { temperature_2m: 20, weather_code: 0 } }), {
            headers: { "content-type": "application/json" },
          });
        };
        const service = await DailyBriefingService.open(dir, cfg.tz);
        const record = await service.generate({ cfg, trigger: "manual", now: new Date("2026-10-14T12:00:00Z"), fetchFn });
        assert.deepEqual(Object.keys(record.sources).sort(), ["board", "calendar", "github", "todoist", "weather"]);
        assert.equal(record.sources.weather.status, "ok");
        assert.equal(record.sources.weather.data?.weather.current.temperatureC, 20);
        assert.equal(calls.length, 1);
        assert.deepEqual(await service.get(record.day), record);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
    await writeFile(path, legacy);
    const record = await readBriefingFile(path);
    assert.deepEqual(record?.sources, emptySources());
    assert.doesNotMatch(JSON.stringify(record), /retired article|retired summary|"news"|"ai"/);
    assert.equal(await readFile(path, "utf8"), legacy);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scheduler: personal briefing runs once, retries source failures, never calls the LLM", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cc-schedule-personal-"));
  try {
    const cfg = loadConfig({
      ADMIN_TOKEN: "t".repeat(32), DATA_DIR: dir, TZ: "UTC",
      LLM_BASE_URL: "https://unused.example/v1", LLM_API_KEY: "unused", LLM_MODEL: "unused",
    });
    const { SettingsStore } = await import("../src/settings");
    const settings = new SettingsStore(dir);
    await settings.load();
    const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
    const record: DailyBriefingRecord = {
      day: "2026-10-14", generatedAt: "2026-10-14T12:00:00Z", trigger: "schedule", sources: emptySources(),
    };
    let calls = 0;
    t.mock.method(dailyBriefing, "generate", async (options: Parameters<DailyBriefingService["generate"]>[0]) => {
      assert.deepEqual(Object.keys(options).sort(), ["board", "cfg", "now", "trigger", "wins"]);
      calls++;
      return record;
    });
    t.mock.method(globalThis, "fetch", async () => { throw new Error("Scheduler must not fetch news or invoke the LLM"); });
    const memory = new Map<string, unknown>();
    const kv: KVLike = {
      get: async <T>(key: string) => memory.get(key) as T | undefined,
      set: async (key, value) => { memory.set(key, value); },
    };
    let now = new Date(record.generatedAt);
    const scheduler = new Scheduler({ cfg, settings, kv, dailyBriefing, now: () => now });
    await scheduler.tick();
    await scheduler.tick();
    assert.equal(calls, 1);
    record.sources.weather = { status: "error", message: "Weather unavailable" };
    now = new Date("2026-10-15T12:00:00Z");
    await scheduler.tick();
    now = new Date("2026-10-15T12:31:00Z");
    await scheduler.tick();
    now = new Date("2026-10-15T13:02:00Z");
    await scheduler.tick();
    assert.equal(calls, 3);
    assert.deepEqual(memory.get("scheduler"), {
      slot: "2026-10-15 06:00", attempts: 2, lastAt: "2026-10-15T12:31:00.000Z", lastStatus: "failed",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
