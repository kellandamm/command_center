import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fetchFeedItems, type FeedHttpFn } from "../src/feeds/poller";
import { parseOpml } from "../src/feeds/opml";
import { FeedsStore, itemId } from "../src/feeds/store";
import { RETENTION } from "../src/feeds/retention";
import type { FeedRow } from "../src/feeds/store";

test("rss: OPML import/export round-trip keeps folders and feed urls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-rss-opml-"));
  try {
    const xml = await readFile(join(import.meta.dirname, "fixtures/inoreader.opml"), "utf8");
    const parsed = parseOpml(xml);
    const folderNames = parsed.folders.map((f) => f.name);
    assert.ok(folderNames.includes("3d Printing"));
    assert.ok(folderNames.includes("Youtube AI"));
    const store = await FeedsStore.open(dir);
    const stats = store.importOpml(xml, { replace: true });
    assert.ok(stats.feeds >= 200);
    assert.ok(stats.folders >= 10);
    const exported = store.exportOpmlDocument();
    const again = parseOpml(exported);
    const exportFolders = new Set(again.folders.map((f) => f.name));
    for (const name of folderNames) assert.ok(exportFolders.has(name), name);
    const importUrls = new Set<string>();
    const walk = (f: { feeds: { xmlUrl: string }[]; folders: typeof parsed.folders }) => {
      f.feeds.forEach((x) => importUrls.add(x.xmlUrl));
      f.folders.forEach(walk);
    };
    parsed.folders.forEach(walk);
    parsed.feeds.forEach((f) => importUrls.add(f.xmlUrl));
    const exportUrls = new Set<string>();
    const walk2 = (f: { feeds: { xmlUrl: string }[]; folders: typeof again.folders }) => {
      f.feeds.forEach((x) => exportUrls.add(x.xmlUrl));
      f.folders.forEach(walk2);
    };
    again.folders.forEach(walk2);
    again.feeds.forEach((f) => exportUrls.add(f.xmlUrl));
    assert.equal(importUrls.size, exportUrls.size);
    for (const u of importUrls) assert.ok(exportUrls.has(u), u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rss: conditional GET 304 does not ingest items", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-rss-304-"));
  try {
    const store = await FeedsStore.open(dir);
    store.upsertFeedRow({
      id: "feed1",
      title: "Example",
      xmlUrl: "https://example.com/feed.xml",
      nextPollAt: new Date().toISOString(),
    });
    const row: FeedRow = {
      id: "feed1",
      folderId: null,
      title: "Example",
      xmlUrl: "https://example.com/feed.xml",
      htmlUrl: null,
      etag: "abc",
      isHn: false,
    };
    const http: FeedHttpFn = async () => ({ status: 304, body: "", finalUrl: row.xmlUrl, etag: "abc" });
    const res = await fetchFeedItems(row, http);
    assert.equal(res.notModified, true);
    assert.equal(res.items.length, 0);
    const ingested = store.ingestParsed(row.id, [], new Date());
    assert.equal(ingested.added, 0);
    store.recordFetchSuccess(row.id, new Date(), { notModified: true, etag: "abc" });
    assert.equal(store.list().length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rss: retention prunes excess per-feed and old unread", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-rss-ret-"));
  try {
    const store = await FeedsStore.open(dir);
    store.upsertFeedRow({ id: "f1", title: "F", xmlUrl: "https://example.com/a.xml", nextPollAt: new Date().toISOString() });
    const now = new Date("2026-10-13T12:00:00Z");
    for (let i = 0; i < RETENTION.perFeed + 20; i++) {
      store.ingestParsed(
        "f1",
        [{ title: `Item ${i}`, link: `https://example.com/${i}`, guid: String(i) }],
        new Date(now.getTime() + i * 1000),
      );
    }
    const bulk = store.ingestParsed("f1", [{ title: "x", link: "https://example.com/x", guid: "x" }], now);
    assert.ok(bulk.added >= 0);
    assert.ok(store.list({ limit: 500 }).length > RETENTION.perFeed);
    store.runRetention(new Date("2026-12-01T12:00:00Z"));
    assert.ok(store.list({ limit: 500 }).length <= RETENTION.perFeed);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rss: legacy feeds.json migrates into sqlite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-rss-mig-"));
  try {
    const id = itemId("https://theverge.com/rss", "https://theverge.com/a", "Story");
    await writeFile(
      join(dir, "feeds.json"),
      JSON.stringify({
        items: [
          {
            id,
            feedId: "https://theverge.com/rss",
            title: "Story",
            link: "https://theverge.com/a",
            summary: "Hello",
            firstSeenAt: "2026-10-01T00:00:00Z",
            read: false,
          },
        ],
        feeds: {},
      }),
      "utf8",
    );
    const store = await FeedsStore.open(dir);
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0]!.title, "Story");
    assert.ok(store.feedCount() >= 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
