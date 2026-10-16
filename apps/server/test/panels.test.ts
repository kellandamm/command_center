import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
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

test("knowledge store: safely migrates legacy notes and preserves Markdown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-knowledge-"));
  try {
    const legacy = "# Existing notes\n\nTrailing spaces stay.  \n";
    await writeFile(join(dir, "notes.md"), legacy, "utf8");
    const store = await NotesStore.open(dir);
    assert.equal(await store.read(), legacy);
    const extra = await store.createNote({ title: "Research", content: "\n# Topic\n\n  ", tags: ["Ideas", "#Research"] });
    assert.equal(store.getNote(extra.id)?.content, "\n# Topic\n\n  ");
    assert.deepEqual(extra.tags, ["ideas", "research"]);
    await store.write("Updated legacy notes\n");
    assert.equal(await store.read(), "Updated legacy notes\n");
    assert.equal(store.getNote(extra.id)?.content, "\n# Topic\n\n  ");
    assert.equal(await readFile(join(dir, "notes.md"), "utf8"), legacy);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("knowledge store: spaces, captured links, search, references, and backup import", async () => {
  const sourceDir = await mkdtemp(join(tmpdir(), "cc-knowledge-source-"));
  const targetDir = await mkdtemp(join(tmpdir(), "cc-knowledge-target-"));
  try {
    const store = await NotesStore.open(sourceDir);
    const space = await store.createSpace({ name: "Research", instructions: "Use concise answers." });
    const first = await store.createNote({ title: "First", content: "See [[Second]].", tags: ["topic"], spaceId: space.id });
    const second = await store.createNote({ title: "Second", content: "Linked note.", spaceId: space.id });
    const source = await store.createSource({ title: "Reference", url: "https://example.com/research", excerpt: "A source excerpt.", spaceId: space.id });
    await store.addSpaceReference(space.id, { type: "board", targetId: "card-1", title: "Board task", excerpt: "Backlog" });
    assert.equal(store.search("source").sources[0]?.id, source.id);
    assert.equal(store.getSpaceContent(space.id)?.notes.length, 2);
    assert.equal(store.getSpaceContent(space.id)?.space.references[0]?.title, "Board task");
    await assert.rejects(store.createSource({ title: "Bad URL", url: "javascript:alert(1)" }), /HTTP or HTTPS/);
    await assert.rejects(store.createSource({ title: "Long URL", url: `https://example.com/${"x".repeat(2_048)}` }), /exceeds 2048 bytes/);

    const graphEdges = store.listNotes().flatMap((note) =>
      [...note.content.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => ({ from: note.id, title: match[1] })),
    );
    assert.deepEqual(graphEdges, [{ from: first.id, title: "Second" }]);

    const restored = await NotesStore.open(targetDir);
    const result = await restored.importBackup(store.exportBackup());
    assert.deepEqual(result, { notes: 2, sources: 1, spaces: 1, skipped: 0 });
    assert.equal(restored.getSpaceContent(space.id)?.notes.length, 2);
    assert.deepEqual(await restored.importBackup(store.exportBackup()), { notes: 0, sources: 0, spaces: 0, skipped: 4 });

    const invalidBackup: any = store.exportBackup();
    invalidBackup.spaces.push({ id: "broken-space", name: "Broken", references: [null] });
    await assert.rejects(restored.importBackup(invalidBackup), /invalid reference/);
    assert.equal(restored.listSpaces().length, 1);

    await store.deleteSpace(space.id);
    assert.equal(store.getNote(first.id)?.spaceId, null);
    assert.equal(store.getSource(source.id)?.spaceId, null);
    await store.deleteNote(second.id);
    assert.equal(store.getNote(second.id), undefined);
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  }
});
