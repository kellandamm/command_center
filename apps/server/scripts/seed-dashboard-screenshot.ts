/**
 * Seed /data for screenshots: notes, agent activity, Hobie, Board, Wins, and Daily Briefing.
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
import { ensureDirs } from "../src/store";

async function main() {
  const dir = process.env.DATA_DIR ?? "/tmp/cc-dashboard-screenshot";
  await ensureDirs(dir);

  const settings = new SettingsStore(dir);
  await settings.load();
  await settings.update({
    briefingTime: "07:00",
  });

  const now = new Date();

  const notes = await NotesStore.open(dir);
  await notes.write("- Ship dashboard layout\n- Review calendar priorities\n");

  const panelUpdates = await PanelUpdatesStore.open(dir);
  await panelUpdates.append({ clientId: "copilot", panel: "activity", markdown: "PR #42 ready for review — CI green." });
  await panelUpdates.append({ clientId: "home-agent", panel: "deploy", markdown: "Staging deploy finished at 14:05 UTC." });
  await panelUpdates.append({ clientId: "copilot", panel: "activity", markdown: "Recallio sync completed — 3 new highlights." });
  await panelUpdates.append({ clientId: "power-automate", panel: "activity", markdown: "Weekly digest email queued for 07:00." });

  const hobie = await HobieQueueStore.open(dir);
  await hobie.enqueue({ clientId: "copilot", title: "Review Q4 deck", body: "Focus on budget slide.", urgent: true }, 20);
  await hobie.enqueue({ clientId: "power-automate", title: "File expense report", body: "Receipt in email.", urgent: false }, 20);

  const board = BoardStore.open(dir);
  board.create({ title: "Polish board drag UX", notes: "Keyboard path + focus rings", column: "Backlog" });
  const handoff = board.create({ title: "Hand off to Hobie agent", notes: "Linked Hobie task for screenshots", column: "Backlog" });
  await board.move(handoff.id, "Ready for Hobie", { hobieQueue: hobie, maxHobiePending: 20 });
  board.create({ title: "Weekly wins rollup", column: "Waiting" });
  board.create({ title: "Waiting on vendor SSO fix", column: "Blocked on me" });
  board.create({ title: "Ship screenshot seeds", column: "Done" });

  const wins = WinsStore.open(dir);
  wins.add({ source: "manual", ref: "seed-1", title: "Board + wins shipped", at: now.toISOString() });
  wins.add({ source: "manual", ref: "seed-2", title: "Briefing board sections", at: new Date(now.getTime() - 86400000).toISOString() });
  wins.saveWeekSummary(
    "2026-W42",
    "A strong week: the kanban board landed, wins tracking is live, and briefing sections surface blockers without opening another tab.",
    "seed-model",
    now.toISOString(),
  );

  const briefing: DailyBriefingRecord = {
    day: "2026-10-14",
    generatedAt: now.toISOString(),
    trigger: "manual",
    sources: {
      todoist: {
        status: "ok",
        data: {
          overdue: [],
          today: [
            {
              id: "1",
              content: "Dashboard screenshot pass",
              description: "",
              priority: 3,
              due: { date: "2026-10-14", datetime: null, string: "today" },
              url: "https://todoist.com",
            },
          ],
        },
      },
      weather: {
        status: "ok",
        data: {
          lat: 41.88,
          lon: -87.65,
          weather: {
            latitude: 41.88,
            longitude: -87.65,
            timezone: "America/Chicago",
            current: { temperatureC: 16, weatherCode: 3, windKmh: 14, observedAt: now.toISOString() },
            today: { highC: 22, lowC: 14, weatherCode: 3 },
            label: "Overcast",
          },
        },
      },
      calendar: { status: "empty", message: "No events" },
      github: { status: "not_configured" },
      board: {
        status: "ok",
        data: {
          blocked: board.blockedOnMe(),
          moved: board.movesSince(new Date(now.getTime() - 24 * 60 * 60_000).toISOString()),
          wins: wins.between(
            new Date(now.getTime() - 48 * 60 * 60_000).toISOString(),
            new Date(now.getTime() - 12 * 60 * 60_000).toISOString(),
          ),
        },
      },
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
