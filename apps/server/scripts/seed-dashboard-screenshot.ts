/**
 * Seed /data for dashboard v1 screenshots: tasks, attention, heatmap, launchpad, and legacy panels.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultDashboardLayout } from "../src/dashboard-layout/defaults";
import { briefingDayPath, writeBriefingFile } from "../src/daily-briefing/storage";
import type { DailyBriefingRecord } from "../src/daily-briefing/types";
import { NotesStore } from "../src/notes/store";
import { panels } from "../src/panels/registry";
import { SettingsStore } from "../src/settings";
import { BoardStore } from "../src/board/store";
import { HobieQueueStore } from "../src/stores/hobie-queue";
import { WinsStore } from "../src/wins/store";
import { PanelUpdatesStore } from "../src/stores/panel-updates";
import { LaunchpadStore } from "../src/launchpad/store";
import { ensureDirs } from "../src/store";

async function main() {
  const dir = process.env.DATA_DIR ?? "/tmp/cc-dashboard-screenshot";
  await ensureDirs(dir);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const settings = new SettingsStore(dir);
  await settings.load();
  await settings.update({ briefingTime: "07:00" });

  const notes = await NotesStore.open(dir);
  await notes.write("# Dashboard seed\n");
  const research = await notes.createNote({
    title: "Q4 planning notes",
    content: "Outline milestones and risks.",
    tags: ["planning"],
  });
  await notes.updateNote(research.id, { content: "Outline milestones, risks, and staffing.\n" });
  const yearAgo = new Date(now);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  await notes.createNote({
    title: "Launch retrospective",
    content: "Shipped dashboard v1.",
    tags: ["history"],
  });
  await notes.createSource({
    title: "Agent security primer",
    url: "https://example.com/agent-security",
    excerpt: "Saved article for rediscover testing.",
    tags: ["reading"],
  });

  const panelUpdates = await PanelUpdatesStore.open(dir);
  await panelUpdates.append({ clientId: "copilot", panel: "activity", markdown: "PR #42 ready for review — CI green." });
  await panelUpdates.append({ clientId: "home-agent", panel: "deploy", markdown: "Staging deploy finished." });

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
  board.create({ title: "Ship screenshot seeds", column: "Done" });
  await board.move(dueSoon.id, "Blocked on me");
  await board.move(dueSoon.id, "Backlog");

  const wins = WinsStore.open(dir);
  wins.add({ source: "manual", ref: "seed-1", title: "Dashboard v1 panels shipped", at: now.toISOString() });
  wins.add({
    source: "manual",
    ref: "seed-2",
    title: "Attention feed tuned",
    at: new Date(now.getTime() - 5 * 86_400_000).toISOString(),
  });

  const launchpad = await LaunchpadStore.open(dir);
  await launchpad.add({ label: "Board", url: "https://example.com/board", emoji: "📋" });
  await launchpad.add({ label: "Briefing", url: "https://example.com/briefing", emoji: "☀️" });
  await launchpad.add({ label: "Calendar", url: "https://example.com/calendar", emoji: "📅" });
  await launchpad.add({ label: "Docs", url: "https://example.com/docs" });

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
  await writeFile(join(dir, "dashboard-layout.json"), JSON.stringify(layout, null, 2));

  board.close();
  wins.close();
  console.log("seeded dashboard screenshot data at", dir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
