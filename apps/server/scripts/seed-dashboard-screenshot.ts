/**
 * Seed /data for dashboard v1 screenshots: tasks, attention, heatmap, launchpad, and legacy panels.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defaultDashboardLayout } from "../src/dashboard-layout/defaults";
import { briefingDayPath, writeBriefingFile } from "../src/daily-briefing/storage";
import type { DailyBriefingRecord } from "../src/daily-briefing/types";
import { DATABASE_FILE, initSchema } from "../src/database";
import { NotesStore } from "../src/notes/store";
import { panels } from "../src/panels/registry";
import { SettingsStore } from "../src/settings";
import { BoardStore } from "../src/board/store";
import { HobieQueueStore } from "../src/stores/hobie-queue";
import { WinsStore } from "../src/wins/store";
import { PanelUpdatesStore } from "../src/stores/panel-updates";
import { LaunchpadStore } from "../src/launchpad/store";
import { ensureDirs } from "../src/store";

async function patchKnowledgeNoteTimes(
  dir: string,
  patches: Array<{ title: string; createdAt?: string; updatedAt?: string }>,
): Promise<void> {
  const path = join(dir, "knowledge.json");
  const raw = JSON.parse(await readFile(path, "utf8")) as { notes: Array<Record<string, unknown>> };
  for (const patch of patches) {
    const note = raw.notes.find((n) => n.title === patch.title);
    if (!note) throw new Error(`seed note not found: ${patch.title}`);
    if (patch.createdAt) note.createdAt = patch.createdAt;
    if (patch.updatedAt) note.updatedAt = patch.updatedAt;
  }
  await writeFile(path, JSON.stringify(raw, null, 2));
}

function seedHeatmapEvents(dir: string, cardId: string, now: Date): void {
  const db = new DatabaseSync(join(dir, DATABASE_FILE));
  initSchema(db);
  const insert = db.prepare(`INSERT INTO card_events (card_id, from_col, to_col, at) VALUES (?, ?, ?, ?)`);
  for (let week = 0; week < 12; week++) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() - week * 7);
    day.setUTCHours(14, week % 5, 0, 0);
    insert.run(cardId, week % 2 ? "Backlog" : "Waiting", week % 2 ? "Waiting" : "Backlog", day.toISOString());
  }
  db.close();
}

async function main() {
  const dir = process.env.DATA_DIR ?? "/tmp/cc-dashboard-screenshot";
  await ensureDirs(dir);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yearAgoToday = new Date(now);
  yearAgoToday.setUTCFullYear(yearAgoToday.getUTCFullYear() - 1);
  const staleUpdated = new Date(now.getTime() - 120 * 86_400_000);
  const noonUtc = (d: Date) => `${d.toISOString().slice(0, 10)}T12:00:00.000Z`;

  const settings = new SettingsStore(dir);
  await settings.load();
  await settings.update({ briefingTime: "07:00" });

  const notes = await NotesStore.open(dir);
  await notes.write("# Dashboard seed\n");

  const sessionNote = await notes.createNote({
    title: "API integration draft",
    content: "First pass on endpoints.",
    tags: ["work"],
  });
  await notes.updateNote(sessionNote.id, { content: "Second pass on endpoints and tests.\n" });
  await notes.updateNote(sessionNote.id, { content: "Third pass — ready for review.\n" });

  await notes.createNote({
    title: "Launch retrospective",
    content: "Shipped dashboard v1.",
    tags: ["history"],
  });
  await notes.createNote({
    title: "Old research draft",
    content: "Ideas to revisit when capacity opens up.",
    tags: ["research"],
  });
  await notes.createSource({
    title: "Agent security primer",
    url: "https://example.com/agent-security",
    excerpt: "Saved article for rediscover testing.",
    tags: ["reading"],
  });

  await patchKnowledgeNoteTimes(dir, [
    { title: "Launch retrospective", createdAt: noonUtc(yearAgoToday), updatedAt: noonUtc(yearAgoToday) },
    { title: "Old research draft", updatedAt: noonUtc(staleUpdated) },
  ]);
  const knowledge = JSON.parse(await readFile(join(dir, "knowledge.json"), "utf8")) as {
    notes: Array<{ title: string; updatedAt: string }>;
    sources: Array<{ title: string; updatedAt: string }>;
  };
  const source = knowledge.sources.find((s) => s.title === "Agent security primer");
  if (source) source.updatedAt = noonUtc(staleUpdated);
  for (let week = 1; week < 6; week++) {
    const edited = new Date(now.getTime() - week * 7 * 86_400_000);
    const note = knowledge.notes.find((n) => n.title === "API integration draft");
    if (note && week === 1) note.updatedAt = edited.toISOString();
  }
  await writeFile(join(dir, "knowledge.json"), JSON.stringify(knowledge, null, 2));

  const panelUpdates = await PanelUpdatesStore.open(dir);
  await panelUpdates.append({ clientId: "copilot", panel: "activity", markdown: "PR #42 ready for review — CI green." });

  const hobie = await HobieQueueStore.open(dir);
  await hobie.enqueue({ clientId: "copilot", title: "Review Q4 deck", body: "Focus on budget slide.", urgent: true }, 20);

  const board = BoardStore.open(dir);
  const dueSoon = board.create({
    title: "Finalize launch checklist",
    notes: "Due soon for screenshot",
    column: "Backlog",
    dueDate: today,
    priority: "high",
  });
  board.create({
    title: "Vendor SSO follow-up",
    notes: "Waiting on external team",
    column: "Waiting",
    dueDate: new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10),
    priority: "normal",
  });
  board.create({ title: "Polish board drag UX", column: "Backlog", priority: "low" });
  const handoff = board.create({ title: "Hand off to Hobie agent", column: "Backlog" });
  await board.move(handoff.id, "Ready for Hobie", { hobieQueue: hobie, maxHobiePending: 20 });
  const activityCard = board.create({ title: "Heatmap activity card", column: "Backlog" });
  await board.move(activityCard.id, "Waiting");
  await board.move(activityCard.id, "Backlog");
  board.create({ title: "Ship screenshot seeds", column: "Done" });

  seedHeatmapEvents(dir, activityCard.id, now);

  const wins = WinsStore.open(dir);
  for (let week = 0; week < 8; week++) {
    const at = new Date(now.getTime() - week * 7 * 86_400_000);
    wins.add({
      source: "manual",
      ref: `seed-win-${week}`,
      title: `Weekly win ${week + 1}`,
      at: at.toISOString(),
    });
  }

  const launchpad = await LaunchpadStore.open(dir);
  await launchpad.add({ label: "Board", url: "https://example.com/board", emoji: "📋" });
  await launchpad.add({ label: "Briefing", url: "https://example.com/briefing", emoji: "☀️" });
  await launchpad.add({ label: "Calendar", url: "https://example.com/calendar", emoji: "📅" });
  await launchpad.add({ label: "Docs", url: "https://example.com/docs" });
  await launchpad.add({ label: "Notes", url: "https://example.com/notes", emoji: "📝" });

  await writeFile(
    join(dir, "attention.json"),
    JSON.stringify({
      pinned: [`card:${dueSoon.id}`],
      hidden: [],
      snoozed: {},
    }, null, 2),
  );

  const briefing: DailyBriefingRecord = {
    day: today,
    generatedAt: now.toISOString(),
    trigger: "manual",
    sources: {
      weather: { status: "empty", message: "No weather" },
      calendar: { status: "empty", message: "No events" },
      topics: { status: "empty", message: "No topics" },
    },
  };
  const briefingDir = join(dir, "daily-briefings");
  await mkdir(briefingDir, { recursive: true, mode: 0o700 });
  await writeBriefingFile(briefingDayPath(briefingDir, briefing.day), briefing);

  const layout = defaultDashboardLayout(panels.map((p) => p.id));
  const tasksEntry = layout.panels.find((p) => p.id === "tasks");
  const attentionEntry = layout.panels.find((p) => p.id === "attention");
  if (tasksEntry) Object.assign(tasksEntry, { x: 0, y: 0, w: 4, h: 4 });
  if (attentionEntry) Object.assign(attentionEntry, { x: 4, y: 0, w: 8, h: 8 });
  for (const entry of layout.panels) {
    if (entry.id === "heatmap") Object.assign(entry, { x: 0, y: 4, w: 4, h: 3 });
    if (entry.id === "launchpad") Object.assign(entry, { x: 0, y: 7, w: 4, h: 3 });
    if (entry.id === "daily-briefing") Object.assign(entry, { x: 4, y: 8, w: 8, h: 2 });
  }
  await writeFile(join(dir, "dashboard-layout.json"), JSON.stringify(layout, null, 2));

  board.close();
  wins.close();
  console.log("seeded dashboard screenshot data at", dir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
