import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { briefingDayPath, listBriefingDays, readBriefingFile, writeBriefingFile } from "../src/daily-briefing/storage";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { Scheduler, type KVLike } from "../src/scheduler";
import type { DailyBriefingRecord } from "../src/daily-briefing/types";
import { applySettings, DEFAULT_SETTINGS } from "../src/settings";
import { buildTopics } from "../src/daily-briefing/topics";

const emptySources = (): DailyBriefingRecord["sources"] => ({
  weather: { status: "ok", data: { lat: 0, lon: 0, weather: { latitude: 0, longitude: 0, timezone: "UTC", current: { temperatureC: 0, weatherCode: 0, windKmh: 0, observedAt: null }, today: { highC: 0, lowC: 0, weatherCode: 0 }, label: "Clear" } } },
  calendar: { status: "not_configured", message: "Calendar is not configured" },
  topics: { status: "not_configured", message: "Add keywords in Settings > Briefing topics.", data: { items: [] } },
});

test("daily briefing: legacy archives omit retired sources without rewriting user data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-legacy-briefing-"));
  try {
    const path = briefingDayPath(dir, "2026-10-14");
    const legacy = JSON.stringify({
      day: "2026-10-14", generatedAt: "2026-10-14T12:00:00Z", trigger: "schedule",
      sources: { ...emptySources(), news: { status: "ok", data: { items: [{ title: "retired article" }] } },
        ai: { status: "ok", data: { content: "retired summary" } },
        todoist: { status: "ok" }, github: { status: "ok" }, board: { status: "ok" } },
    });
    await writeFile(path, legacy);
    const record = await readBriefingFile(path);
    assert.deepEqual(record?.sources, emptySources());
    assert.doesNotMatch(JSON.stringify(record), /retired article|retired summary|"news"|"ai"|"todoist"|"github"|"board"/);
    assert.equal(await readFile(path, "utf8"), legacy);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
    assert.deepEqual(Object.keys(record.sources).sort(), ["calendar", "topics", "weather"]);
    assert.equal(record.sources.weather.status, "ok");
    assert.equal(record.sources.weather.data?.weather.current.temperatureC, 20);
    assert.equal(calls.length, 1);
    assert.deepEqual(await service.get(record.day), record);
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
    await settings.update({ briefingTopics: ["Microsoft Fabric"] });
    const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
    const record: DailyBriefingRecord = {
      day: "2026-10-14", generatedAt: "2026-10-14T12:00:00Z", trigger: "schedule", sources: emptySources(),
    };
    let calls = 0;
    t.mock.method(dailyBriefing, "generate", async (options: Parameters<DailyBriefingService["generate"]>[0]) => {
      assert.deepEqual(Object.keys(options).sort(), ["calendar", "cfg", "now", "topics", "trigger"]);
      assert.deepEqual(options.topics, ["Microsoft Fabric"]);
      calls++;
      return record;
    });
    t.mock.method(globalThis, "fetch", async () => { throw new Error("Scheduler must use the briefing service"); });
    const memory = new Map<string, unknown>();
    const kv: KVLike = {
      get: async <T>(key: string) => memory.get(key) as T | undefined,
      set: async (key, value) => { memory.set(key, value); },
    };
    let now = new Date(record.generatedAt);
    const scheduler = new Scheduler({ deployment: cfg, cfg, settings, kv, dailyBriefing, now: () => now });
    await scheduler.tick();
    await scheduler.tick();
    assert.equal(calls, 1);
    record.sources.topics = { status: "error", message: "Search unavailable" };
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

test("briefing topics: settings validate, deduplicate and preserve unrelated preferences", () => {
  const settings = applySettings(DEFAULT_SETTINGS, { briefingTopics: [" Microsoft Fabric ", "microsoft fabric", "AI security"] });
  assert.deepEqual(settings.briefingTopics, ["Microsoft Fabric", "AI security"]);
  assert.equal(settings.briefingTime, DEFAULT_SETTINGS.briefingTime);
  assert.deepEqual(applySettings(settings, { briefingTopics: [] }).briefingTopics, []);
  for (const value of ["topic", [""], [123], ["x".repeat(121)], ["two\nlines"], Array(11).fill("x")]) {
    assert.throws(() => applySettings(settings, { briefingTopics: value }), /topic/i);
  }
  assert.deepEqual(applySettings(settings, { briefingTime: "08:00" }).briefingTopics, settings.briefingTopics);
});

const topicConfig = () => loadConfig({
  ADMIN_TOKEN: "t".repeat(32), BRAVE_SEARCH_API_KEY: "search-key",
  LLM_BASE_URL: "https://llm.example/v1", LLM_API_KEY: "llm-key", LLM_MODEL: "test", TZ: "UTC",
});

test("briefing topics: searches recent web results, sanitizes and deduplicates sources, summarizes excerpts", async () => {
  const cfg = topicConfig();
  let searches = 0, completions = 0;
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.ok(init?.signal);
    if (url.hostname === "api.search.brave.com") {
      searches++;
      assert.equal(url.searchParams.get("q"), "Microsoft Fabric");
      assert.equal(url.searchParams.get("freshness"), "pd");
      assert.equal(new Headers(init.headers).get("X-Subscription-Token"), "search-key");
      return Response.json({ web: { results: [
        { title: "<b>New feature</b>", url: "https://example.com/update#one", description: "<b>Feature launch</b>", extra_snippets: ["More detail"] },
        { title: "Duplicate", url: "https://example.com/update#two", description: "Same story" },
        { title: "Unsafe", url: "javascript:alert(1)", description: "Ignore" },
        { title: "Other story", url: "https://example.org/story", description: "A second source" },
      ] } });
    }
    assert.equal(url.href, "https://llm.example/v1/chat/completions");
    completions++;
    const body = JSON.parse(String(init?.body));
    assert.match(body.messages[0].content, /untrusted/);
    assert.match(body.messages[1].content, /Feature launch More detail/);
    assert.equal(new Headers(init?.headers).get("X-Subscription-Token"), null);
    return Response.json({ choices: [{ message: { content: "<b>A useful digest [1].</b>" } }] });
  };
  const block = await buildTopics(cfg, ["Microsoft Fabric"], fetchFn);
  assert.equal(block.status, "ok");
  assert.equal(block.data?.items[0]?.summary, "A useful digest [1].");
  assert.deepEqual(block.data?.items[0]?.articles.map((a) => a.url), ["https://example.com/update", "https://example.org/story"]);
  assert.equal(searches, 1);
  assert.equal(completions, 1);
});

test("briefing topics: missing config and empty results make no AI requests", async () => {
  let calls = 0;
  const fetchFn: typeof fetch = async () => { calls++; return Response.json({ type: "search", web: { results: [] } }); };
  assert.equal((await buildTopics(topicConfig(), [], fetchFn)).status, "not_configured");
  assert.equal((await buildTopics({ ...topicConfig(), braveSearchApiKey: null }, ["AI"], fetchFn)).status, "not_configured");
  assert.equal((await buildTopics({ ...topicConfig(), llmModel: null }, ["AI"], fetchFn)).status, "not_configured");
  assert.equal(calls, 0);
  const block = await buildTopics(topicConfig(), ["AI"], fetchFn);
  assert.equal(block.status, "empty");
  assert.equal(block.data?.items[0]?.status, "empty");
  assert.equal(calls, 1);
});

test("briefing topics: one failed lookup does not discard other topics; summary errors retain source links", async () => {
  const fetchFn: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.get("q") === "failure") return new Response("", { status: 429 });
    if (url.hostname === "api.search.brave.com") return Response.json({ web: { results: [
      { title: "A story", url: "https://example.com/story", description: "Story excerpt" },
    ] } });
    return new Response("unavailable", { status: 503 });
  };
  const block = await buildTopics(topicConfig(), ["failure", "summary failure"], fetchFn);
  assert.equal(block.status, "error");
  assert.match(block.data!.items[0]!.message!, /429/);
  assert.equal(block.data!.items[1]!.articles.length, 1);
  assert.equal(block.data!.items[1]!.status, "error");
});

test("daily briefing: overlapping manual and scheduled requests share a persisted generation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-topics-flight-"));
  try {
    const cfg = topicConfig();
    const service = await DailyBriefingService.open(dir, cfg.tz);
    let calls = 0;
    const fetchFn: typeof fetch = async () => { calls++; return Response.json({ current: { temperature_2m: 20 } }); };
    const options = { cfg, topics: [], trigger: "manual" as const, now: new Date("2026-10-21T12:00:00Z"), fetchFn };
    const first = service.generate(options);
    const second = service.generate({ ...options, trigger: "schedule" });
    assert.equal(first, second);
    assert.equal(service.generationState("2026-10-21").status, "generating");
    const record = await first;
    assert.equal(service.generationState(record.day).status, "idle");
    assert.deepEqual(await service.get(record.day), record);
    assert.equal(calls, 1);
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

test("daily briefing: old editions without topics stay readable and untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-old-topics-"));
  try {
    const { topics: _topics, ...sources } = emptySources();
    const raw = JSON.stringify({ day: "2026-10-14", generatedAt: "2026-10-14T12:00:00Z", trigger: "manual", sources });
    const path = briefingDayPath(dir, "2026-10-14");
    await writeFile(path, raw);
    assert.equal((await readBriefingFile(path))?.sources.topics.status, "not_configured");
    assert.equal(await readFile(path, "utf8"), raw);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("daily briefing: persistence failures surface in refresh status and can be retried", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-briefing-write-"));
  try {
    const cfg = topicConfig();
    const service = await DailyBriefingService.open(dir, cfg.tz);
    const day = "2026-10-21";
    const target = briefingDayPath(join(dir, "daily-briefings"), day);
    await mkdir(target);
    const options = { cfg, trigger: "manual" as const, now: new Date(`${day}T12:00:00Z`), fetchFn: async () => Response.json({ current: {} }) };
    await assert.rejects(service.generate(options));
    assert.equal(service.generationState(day).status, "error");
    assert.ok(service.generationState(day).message);
    await rm(target, { recursive: true });
    await service.generate(options);
    assert.equal(service.generationState(day).status, "idle");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
