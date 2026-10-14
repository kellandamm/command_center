/**
 * Seed /data RSS corpus from test OPML plus a demo YouTube article for UI screenshots.
 * Usage: DATA_DIR=/path ADMIN_TOKEN=... tsx scripts/seed-rss-opml.ts [path-to.opml]
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { feedIdFromUrl } from "../src/feeds/opml";
import { FeedsStore } from "../src/feeds/store";
import { ensureDirs } from "../src/store";

const dir = process.env.DATA_DIR ?? join(fileURLToPath(new URL(".", import.meta.url)), "../../.dev-data");
const opmlPath = process.argv[2] ?? join(import.meta.dirname, "../test/fixtures/inoreader.opml");

async function main() {
  await ensureDirs(dir);
  const store = await FeedsStore.open(dir);
  const xml = await readFile(opmlPath, "utf8");
  const stats = store.importOpml(xml, { replace: true });
  const ytUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=UCVc6AHfGw9b2zOE_ZGfmsnw";
  const ytId = feedIdFromUrl(ytUrl);
  store.upsertFeedRow({
    id: ytId,
    title: "Make Anything // 3D Printing Channel",
    xmlUrl: ytUrl,
    folderId: undefined,
    sortOrder: 0,
    nextPollAt: new Date().toISOString(),
  });
  store.ingestParsed(
    ytId,
    [
      {
        title: "How I built a parametric lamp shade (demo)",
        link: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        guid: "demo-yt-1",
        summary: "Sample YouTube row with thumbnail and duration for the news reader UI.",
        thumbUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        durationSec: 31 * 60 + 30,
        contentHtml: "<p>Embedded reading pane content for screenshot verification.</p>",
      },
    ],
    new Date(),
  );
  await store.save();
  console.log(JSON.stringify({ dataDir: dir, ...stats, feedCount: store.feedCount(), entries: store.list({ limit: 5 }).length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
