/**
 * Seed /data for dashboard screenshots: feeds, notes, MCP activity, Hobie queue,
 * AI Security roundup, and v2 default layout.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultDashboardLayout } from "../src/dashboard-layout/defaults";
import { writeRoundupFile, roundupPath, ensureRoundupDir } from "../src/ai-security/storage";
import type { AiSecurityRoundup } from "../src/ai-security/types";
import { briefingDayPath, writeBriefingFile } from "../src/daily-briefing/storage";
import type { DailyBriefingRecord } from "../src/daily-briefing/types";
import { FeedsStore } from "../src/feeds/store";
import { NotesStore } from "../src/notes/store";
import { panels } from "../src/panels/registry";
import { SettingsStore } from "../src/settings";
import { HobieQueueStore } from "../src/stores/hobie-queue";
import { PanelUpdatesStore } from "../src/stores/panel-updates";
import { ensureDirs } from "../src/store";

async function main() {
  const dir = process.env.DATA_DIR ?? "/tmp/cc-dashboard-screenshot";
  await ensureDirs(dir);

  const settings = new SettingsStore(dir);
  await settings.load();
  await settings.update({ feeds: "hn\n", fetchIntervalMinutes: 30, briefingTime: "07:00" });

  const feeds = await FeedsStore.open(dir);
  const now = new Date();
  feeds.ingest("hn", [
    { title: "Ukraine claims Starlink is suddenly disrupting service for its military", link: "https://example.com/a", summary: "Operators report intermittent drops along the eastern front." },
    { title: "HomeView doesn't natively support 4K on older Apple TVs", link: "https://example.com/b", summary: "Workarounds involve wired backhaul and manual bitrate caps." },
    { title: "Critical OpenSSL patch ships for embedded devices", link: "https://example.com/c", summary: "Vendors urge firmware updates within 48 hours." },
    { title: "AI agents now draft half of internal status updates", link: "https://example.com/d", summary: "Teams still review before posting to company wiki." },
    { title: "Rust 1.90 stabilizes async traits for library authors", link: "https://example.com/e", summary: "Migration guide highlights dyn compatibility changes." },
  ], now);
  await feeds.save();

  const notes = await NotesStore.open(dir);
  await notes.write("- Ship dashboard layout v2\n- Review tagged news chips\n");

  const panelUpdates = await PanelUpdatesStore.open(dir);
  await panelUpdates.append({ clientId: "copilot", panel: "activity", markdown: "PR #42 ready for review — CI green." });
  await panelUpdates.append({ clientId: "home-agent", panel: "deploy", markdown: "Staging deploy finished at 14:05 UTC." });

  const hobie = await HobieQueueStore.open(dir);
  await hobie.enqueue({ clientId: "copilot", title: "Review Q4 deck", body: "Focus on budget slide.", urgent: true }, 20);
  await hobie.enqueue({ clientId: "power-automate", title: "File expense report", body: "Receipt in email.", urgent: false }, 20);

  const aiDir = join(dir, "ai-security");
  await ensureRoundupDir(aiDir);
  const roundup: AiSecurityRoundup = {
    weekOf: "2026-10-06",
    publishedAt: now.toISOString(),
    items: [
      { title: "OAuth token replay in popular CI plugin", summary: "Rotate integration secrets and upgrade the CI plugin to the patched release.", sourceUrl: "https://example.com/sec1", date: "2026-10-08" },
      { title: "Prompt injection in support chatbots", summary: "Sanitize tool outputs before sending them back to the language model.", sourceUrl: "https://example.com/sec2", date: "2026-10-09" },
      { title: "S3 bucket exposed via misconfigured CDN", summary: "Block public ACLs on the bucket and enable object access logging.", sourceUrl: "https://example.com/sec3", date: "2026-10-09" },
      { title: "npm package typosquat wave", summary: "Verify package names in lockfiles before running install in CI.", sourceUrl: "https://example.com/sec4", date: "2026-10-10" },
      { title: "Corporate SSO session fixation", summary: "Apply the identity provider vendor patch from the October advisory.", sourceUrl: "https://example.com/sec5", date: "2026-10-11" },
      { title: "Firmware signing key leak", summary: "Revoke the exposed signing key and re-sign affected device images.", sourceUrl: "https://example.com/sec6", date: "2026-10-12" },
    ],
  };
  await writeRoundupFile(roundupPath(aiDir, roundup.weekOf), roundup);

  const briefing: DailyBriefingRecord = {
    day: "2026-10-14",
    generatedAt: now.toISOString(),
    trigger: "manual",
    sources: {
      news: { status: "ok", data: { items: feeds.list({ limit: 5 }), itemCount: 5 } },
      ai: { status: "ok", data: { content: "Quiet morning: two security advisories, one infra patch. Prioritize OpenSSL firmware.", itemCount: 2 } },
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
      github: { status: "empty", message: "Not configured" },
    },
  };
  const briefingDir = join(dir, "daily-briefings");
  await mkdir(briefingDir, { recursive: true, mode: 0o700 });
  await writeBriefingFile(briefingDayPath(briefingDir, briefing.day), briefing);

  const layout = defaultDashboardLayout(panels.map((p) => p.id));
  await writeFile(join(dir, "dashboard-layout.json"), JSON.stringify(layout, null, 2));

  console.log("seeded dashboard screenshot data at", dir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
