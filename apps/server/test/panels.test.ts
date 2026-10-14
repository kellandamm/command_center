import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseIcsEvents, upcomingEvents } from "../src/calendar/parse-ics";
import { DEFAULT_WEATHER_LAT, DEFAULT_WEATHER_LON, loadConfig, parseIcsUrls } from "../src/config";
import { NotesStore } from "../src/notes/store";
import { weatherCodeLabel } from "../src/weather/open-meteo";

test("config: weather defaults to Chicago; ICS_URLS parses", () => {
  const cfg = loadConfig({ ADMIN_TOKEN: "x".repeat(32), ALLOW_INSECURE_NO_AUTH: "1" });
  assert.equal(cfg.weatherLat, DEFAULT_WEATHER_LAT);
  assert.equal(cfg.weatherLon, DEFAULT_WEATHER_LON);
  assert.deepEqual(parseIcsUrls(" https://a.example/a.ics ,https://b.example/b.ics "), ["https://a.example/a.ics", "https://b.example/b.ics"]);
  assert.deepEqual(parseIcsUrls(""), []);
});

test("weather: WMO labels", () => {
  assert.equal(weatherCodeLabel(0), "Clear");
  assert.equal(weatherCodeLabel(999), "Code 999");
});

test("calendar: parses VEVENT and sorts upcoming", () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:1
SUMMARY:Past
DTSTART:20200101T100000Z
DTEND:20200101T110000Z
END:VEVENT
BEGIN:VEVENT
UID:2
SUMMARY:Future meet
DTSTART:20300610T140000Z
DTEND:20300610T150000Z
LOCATION:Room A
END:VEVENT
END:VCALENDAR`;
  const now = new Date("2030-06-01T00:00:00Z");
  const events = parseIcsEvents(ics, "UTC", now);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.summary, "Future meet");
  assert.equal(events[0]!.location, "Room A");
  const up = upcomingEvents(events, 5, 14, now);
  assert.equal(up.length, 1);
});

test("notes store: persists on data dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-notes-"));
  try {
    const store = await NotesStore.open(dir);
    assert.equal(await store.read(), "");
    await store.write("# hello\n");
    assert.equal(await store.read(), "# hello\n");
    assert.equal(NotesStore.pathFor(dir).endsWith("notes.md"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
