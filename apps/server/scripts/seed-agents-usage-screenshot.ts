/**
 * Seed agents-usage.json for dashboard screenshots.
 * STALE=1 writes a reading older than 26h (for stale-state capture).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function main() {
  const dir = process.env.DATA_DIR;
  if (!dir) throw new Error("DATA_DIR required");
  const stale = process.env.STALE === "1";
  const now = new Date("2026-10-30T14:00:00.000Z");
  const asOf = stale
    ? new Date(now.getTime() - 27 * 60 * 60 * 1000).toISOString()
    : now.toISOString();
  const resetsAt = "2026-11-02T09:00:00.000Z";
  await writeFile(
    join(dir, "agents-usage.json"),
    JSON.stringify(
      {
        snapshots: [
          {
            asOf,
            weeklyPercentUsed: stale ? 38 : 42,
            resetsAt,
            byBot: [
              { name: "Build bot", share: 18.5 },
              { name: "Review bot", share: 12.2 },
              { name: "Docs bot", share: 6.1 },
              { name: "Other", share: 5.2 },
            ],
            byRoutine: [],
            byDay: [],
          },
        ],
        checkins: [],
      },
      null,
      2,
    ),
  );
  if (!stale) {
    const layoutPath = join(dir, "dashboard-layout.json");
    const layout = JSON.parse(await readFile(layoutPath, "utf8")) as {
      panels: Array<{ id: string; collapsed?: boolean; x: number; y: number; w: number; h: number }>;
    };
    const entry = layout.panels.find((p) => p.id === "agents-usage");
    if (entry) {
      entry.collapsed = false;
      entry.w = 4;
      entry.h = 4;
      entry.x = 0;
      entry.y = 0;
    }
    await writeFile(layoutPath, JSON.stringify(layout, null, 2));
  } else {
    const layoutPath = join(dir, "dashboard-layout.json");
    const layout = JSON.parse(await readFile(layoutPath, "utf8")) as {
      panels: Array<{ id: string; collapsed?: boolean; x: number; y: number; w: number; h: number }>;
    };
    const entry = layout.panels.find((p) => p.id === "agents-usage");
    if (entry) {
      entry.collapsed = false;
      entry.w = 4;
      entry.h = 4;
    }
    await writeFile(layoutPath, JSON.stringify(layout, null, 2));
  }
  console.log("seeded agents usage at", dir, stale ? "(stale)" : "(fresh)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
