import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseIcsEvents } from "../src/calendar/parse-ics";
import { fetchCalendarEvents } from "../src/calendar/service";

test("calendar parses feed timezones, event details, and exclusive all-day dates", () => {
  const events = parseIcsEvents(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:timed
SUMMARY:Design review
DTSTART;TZID=America/Chicago:20300610T093015
DTEND;TZID=America/Chicago:20300610T103015
DESCRIPTION:Agenda\\nReview designs\\, plans
URL:https://example.com/event
LOCATION:Room A
END:VEVENT
BEGIN:VEVENT
UID:all-day
SUMMARY:Trip
DTSTART;VALUE=DATE:20300611
DTEND;VALUE=DATE:20300614
END:VEVENT
END:VCALENDAR`, "UTC", new Date("2030-06-01"));
  assert.equal(events[0]!.start.toISOString(), "2030-06-10T14:30:15.000Z");
  assert.equal(events[0]!.end?.toISOString(), "2030-06-10T15:30:15.000Z");
  assert.equal(events[0]!.description, "Agenda\nReview designs, plans");
  assert.equal(events[0]!.url, "https://example.com/event");
  assert.equal(events[1]!.allDay, true);
  assert.equal(events[1]!.end?.toISOString().slice(0, 10), "2030-06-14");
});

test("calendar floating dates follow configured timezone across daylight-saving changes", () => {
  const events = parseIcsEvents(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:before-dst
SUMMARY:Before daylight saving
DTSTART:20300309T090000
END:VEVENT
BEGIN:VEVENT
UID:after-dst
SUMMARY:After daylight saving
DTSTART:20300311T090000
END:VEVENT
END:VCALENDAR`, "America/Chicago", new Date("2030-03-01"));
  assert.equal(events[0]!.start.toISOString(), "2030-03-09T15:00:00.000Z");
  assert.equal(events[1]!.start.toISOString(), "2030-03-11T14:00:00.000Z");
});

test("calendar range loads past events and all matching events, not only the next twelve", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-calendar-"));
  try {
    const file = join(dir, "work.ics");
    const events = Array.from({ length: 25 }, (_, index) => `BEGIN:VEVENT
UID:event-${index}
SUMMARY:Event ${index}
DTSTART:202006${String(index + 1).padStart(2, "0")}T140000Z
DTEND:202006${String(index + 1).padStart(2, "0")}T150000Z
END:VEVENT`).join("\n");
    await writeFile(file, `BEGIN:VCALENDAR\nX-WR-CALNAME:Work calendar\n${events}\nEND:VCALENDAR`);
    const options = { localFiles: [file], rangeStart: new Date("2020-06-01"), rangeEnd: new Date("2020-07-01"), limit: 2_000 };
    const result = await fetchCalendarEvents([], "America/Chicago", options);
    assert.equal(result.events.length, 25);
    assert.equal(result.timezone, "America/Chicago");
    assert.equal(result.truncated, false);
    assert.equal(result.feeds[0]!.name, "Work calendar");
    assert.ok(result.events.every((event) => event.calendarId === result.feeds[0]!.id));
    const limited = await fetchCalendarEvents([], "UTC", { ...options, limit: 10 });
    assert.equal(limited.events.length, 10);
    assert.equal(limited.truncated, true);
    assert.equal((await fetchCalendarEvents([], "UTC", { localFiles: [file] })).events.length, 0);
    const repeated = await fetchCalendarEvents([], "UTC", options);
    assert.equal(repeated.feeds[0]!.id, result.feeds[0]!.id);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("calendar ranges include spanning events and treat DTEND as exclusive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-calendar-range-"));
  try {
    const file = join(dir, "personal.ics");
    await writeFile(file, `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:spanning
SUMMARY:Spanning
DTSTART:20200609T230000Z
DTEND:20200610T010000Z
END:VEVENT
BEGIN:VEVENT
UID:ended
SUMMARY:Ended at boundary
DTSTART:20200609T220000Z
DTEND:20200610T000000Z
END:VEVENT
BEGIN:VEVENT
UID:future
SUMMARY:Starts at end boundary
DTSTART:20200611T000000Z
END:VEVENT
BEGIN:VEVENT
UID:all-day
SUMMARY:All-day trip
DTSTART;VALUE=DATE:20200609
DTEND;VALUE=DATE:20200611
END:VEVENT
END:VCALENDAR`);
    const result = await fetchCalendarEvents([], "UTC", {
      localFiles: [file, join(dir, "missing.ics")],
      rangeStart: new Date("2020-06-10"), rangeEnd: new Date("2020-06-11"), limit: 2_000,
    });
    assert.deepEqual(new Set(result.events.map((event) => event.uid)), new Set(["spanning", "all-day"]));
    assert.equal(result.feeds[1]!.ok, false);
    assert.match(result.feeds[1]!.error!, /ENOENT/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
