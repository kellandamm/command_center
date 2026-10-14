import { createHash } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readJson } from "../store";
import { parseFeedList } from "./parse";
import type { ParsedItem } from "./parse";
import { HN_API_URL, HN_FEED_ID } from "./parse";
import { feedIdFromUrl, folderIdFromPath, type OpmlFeed, type OpmlFolder, parseOpml, exportOpml } from "./opml";
import { initSchema } from "./schema";
import { POLL, RETENTION } from "./retention";
import { SummaryStore } from "./summary-store";

export interface StoredItem {
  id: string;
  feedId: string;
  title: string;
  link?: string;
  summary?: string;
  publishedAt?: string;
  firstSeenAt: string;
  read: boolean;
  starred?: boolean;
  thumbUrl?: string;
  durationSec?: number;
  feedTitle?: string;
  contentHtml?: string;
}

export interface FeedStatus {
  feedId: string;
  lastFetchAt?: string;
  lastError?: string;
  itemCount: number;
}

export interface FeedRow {
  id: string;
  folderId: string | null;
  title: string;
  xmlUrl: string;
  htmlUrl: string | null;
  etag?: string;
  lastModified?: string;
  isHn: boolean;
}

export interface FolderTreeNode {
  id: string;
  name: string;
  parentId: string | null;
  unread: number;
  feeds: Array<{ id: string; title: string; unread: number }>;
  folders: FolderTreeNode[];
}

interface LegacyFeedsData {
  items: StoredItem[];
  feeds: Record<string, { lastFetchAt?: string; lastError?: string }>;
}

export function itemId(feedId: string, link: string | undefined, title: string): string {
  const key = link || title;
  return createHash("sha256").update(`${feedId}\0${key}`).digest("hex").slice(0, 24);
}

function staggerMs(index: number): number {
  return (index % 60) * 60_000;
}

export interface IngestResult {
  added: number;
  ids: string[];
}

export class FeedsStore {
  private db: DatabaseSync;
  private fts5: boolean;
  private dirty = false;
  readonly summaries: SummaryStore;

  constructor(private dir: string, db: DatabaseSync, fts5: boolean) {
    this.db = db;
    this.fts5 = fts5;
    this.summaries = new SummaryStore(db, fts5, (id) => Boolean(this.db.prepare("SELECT 1 FROM entries WHERE id = ?").get(id)));
  }

  static async open(dir: string, opts?: { settingsFeeds?: string }): Promise<FeedsStore> {
    const path = join(dir, "rss.sqlite");
    const db = new DatabaseSync(path);
    const { fts5 } = initSchema(db);
    const store = new FeedsStore(dir, db, fts5);
    await store.migrateLegacyIfNeeded(opts?.settingsFeeds);
    return store;
  }

  feedContext(feedId: string): { feedTitle: string | null; folderId: string | null; folderName: string | null } {
    const row = this.db.prepare("SELECT f.title, f.folder_id, fo.name AS folder_name FROM feeds f LEFT JOIN folders fo ON fo.id = f.folder_id WHERE f.id = ?").get(feedId) as
      | { title: string; folder_id: string | null; folder_name: string | null }
      | undefined;
    if (!row) return { feedTitle: null, folderId: null, folderName: null };
    return { feedTitle: row.title, folderId: row.folder_id, folderName: row.folder_name };
  }

  async save(): Promise<void> {
    if (this.dirty) {
      // WAL mode persists on write; checkpoint for tests reading file copy.
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      this.dirty = false;
    }
  }

  feedCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM feeds").get() as { n: number | bigint };
    return Number(row.n);
  }

  private async migrateLegacyIfNeeded(settingsFeeds?: string): Promise<void> {
    const n = this.feedCount();
    if (n > 0) return;
    const legacyPath = join(this.dir, "feeds.json");
    const legacy = await readJson<LegacyFeedsData>(legacyPath);
    if (settingsFeeds?.trim()) this.migrateFromSettings(settingsFeeds);
    if (!legacy?.items?.length) return;

    const now = new Date().toISOString();
    if (legacy?.items) {
      for (const it of legacy.items) {
        if (!this.db.prepare("SELECT 1 FROM feeds WHERE id = ?").get(it.feedId)) {
          const isHn = it.feedId === HN_FEED_ID;
          this.upsertFeedRow({
            id: it.feedId,
            title: isHn ? "Hacker News" : it.feedId.replace(/^https?:\/\//, "").slice(0, 80),
            xmlUrl: isHn ? HN_API_URL : it.feedId,
            isHn,
            sortOrder: 0,
            nextPollAt: now,
          });
        }
        this.insertEntry(it.feedId, {
          title: it.title,
          link: it.link,
          guid: it.link || it.title,
          summary: it.summary,
          date: it.publishedAt,
        }, it.firstSeenAt, !!it.read);
      }
    }
    if (existsSync(legacyPath)) {
      try {
        renameSync(legacyPath, join(this.dir, "feeds.json.migrated"));
      } catch {
        /* best effort */
      }
    }
    this.dirty = true;
  }

  /** Import settings feed list + legacy JSON when opening with explicit feeds text. */
  migrateFromSettings(feedsText: string): void {
    if (this.feedCount() > 0) return;
    const parsed = parseFeedList(feedsText);
    const now = new Date().toISOString();
    parsed.feeds.forEach((spec, i) => {
      this.upsertFeedRow({
        id: spec.id,
        title: spec.label,
        xmlUrl: spec.url,
        isHn: spec.id === HN_FEED_ID,
        sortOrder: i,
        nextPollAt: new Date(Date.parse(now) + staggerMs(i)).toISOString(),
      });
    });
    this.dirty = true;
  }

  importOpml(body: string, opts: { replace?: boolean } = {}): { feeds: number; folders: number } {
    const doc = parseOpml(body);
    if (opts.replace) {
      this.db.exec("DELETE FROM entries; DELETE FROM feeds; DELETE FROM folders");
      if (this.fts5) this.db.exec("DELETE FROM entry_fts");
    }
    let folderCount = 0;
    let feedCount = 0;
    const now = Date.now();
    const walk = (folders: OpmlFolder[], parentId: string | null, path: string[], baseOrder: number) => {
      folders.forEach((folder, fi) => {
        const pathSegs = [...path, folder.name];
        const fid = folderIdFromPath(pathSegs);
        this.db
          .prepare(
            `INSERT INTO folders (id, parent_id, name, sort_order) VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               parent_id = excluded.parent_id,
               name = excluded.name,
               sort_order = excluded.sort_order`,
          )
          .run(fid, parentId, folder.name, baseOrder + fi);
        folderCount++;
        folder.feeds.forEach((f, j) => {
          this.addOpmlFeed(f, fid, j, now + feedCount);
          feedCount++;
        });
        walk(folder.folders, fid, pathSegs, 0);
      });
    };
    walk(doc.folders, null, [], 0);
    doc.feeds.forEach((f, j) => {
      this.addOpmlFeed(f, null, j, now + feedCount);
      feedCount++;
    });
    this.dirty = true;
    return { feeds: feedCount, folders: folderCount };
  }

  private addOpmlFeed(f: OpmlFeed, folderId: string | null, sortOrder: number, staggerIndex: number) {
    const id = f.xmlUrl.includes("hacker-news") && f.title.toLowerCase().includes("hacker") ? HN_FEED_ID : feedIdFromUrl(f.xmlUrl);
    const isHn = id === HN_FEED_ID;
    this.upsertFeedRow(
      {
        id,
        title: f.title,
        xmlUrl: isHn ? HN_API_URL : f.xmlUrl,
        htmlUrl: f.htmlUrl,
        folderId,
        isHn,
        sortOrder,
        nextPollAt: new Date(Date.now() + staggerMs(staggerIndex)).toISOString(),
      },
      { setFolder: true },
    );
  }

  exportOpmlDocument(): string {
    const folders = this.db.prepare("SELECT id, parent_id, name, sort_order FROM folders ORDER BY sort_order, name").all() as Array<{
      id: string;
      parent_id: string | null;
      name: string;
    }>;
    const feeds = this.db.prepare("SELECT id, folder_id, title, xml_url, html_url, sort_order FROM feeds ORDER BY sort_order, title").all() as Array<{
      id: string;
      folder_id: string | null;
      title: string;
      xml_url: string;
      html_url: string | null;
    }>;
    const build = (parentId: string | null): OpmlFolder[] =>
      folders
        .filter((f) => (f.parent_id ?? null) === parentId)
        .map((f) => ({
          name: f.name,
          feeds: feeds
            .filter((x) => x.folder_id === f.id)
            .map((x) => ({ title: x.title, xmlUrl: x.xml_url, htmlUrl: x.html_url ?? undefined })),
          folders: build(f.id),
        }));
    const tree = {
      folders: build(null),
      feeds: feeds.filter((x) => !x.folder_id).map((x) => ({ title: x.title, xmlUrl: x.xml_url, htmlUrl: x.html_url ?? undefined })),
    };
    return exportOpml(tree);
  }

  upsertFeedRow(
    row: {
      id: string;
      title: string;
      xmlUrl: string;
      htmlUrl?: string;
      folderId?: string | null;
      isHn?: boolean;
      sortOrder?: number;
      nextPollAt: string;
    },
    opts?: { setFolder?: boolean },
  ) {
    const setFolder = opts?.setFolder === true;
    const folderId = row.folderId ?? null;
    if (setFolder) {
      this.db
        .prepare(
          `INSERT INTO feeds (id, folder_id, title, xml_url, html_url, sort_order, next_poll_at, is_hn)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             folder_id = excluded.folder_id,
             title = excluded.title,
             xml_url = excluded.xml_url,
             html_url = COALESCE(excluded.html_url, feeds.html_url),
             sort_order = excluded.sort_order`,
        )
        .run(row.id, folderId, row.title, row.xmlUrl, row.htmlUrl ?? null, row.sortOrder ?? 0, row.nextPollAt, row.isHn ? 1 : 0);
    } else {
      this.db
        .prepare(
          `INSERT INTO feeds (id, folder_id, title, xml_url, html_url, sort_order, next_poll_at, is_hn)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             xml_url = excluded.xml_url,
             html_url = COALESCE(excluded.html_url, feeds.html_url),
             sort_order = excluded.sort_order`,
        )
        .run(row.id, folderId, row.title, row.xmlUrl, row.htmlUrl ?? null, row.sortOrder ?? 0, row.nextPollAt, row.isHn ? 1 : 0);
    }
    this.dirty = true;
  }

  addFeed(input: { xmlUrl: string; title?: string; folderId?: string | null }): { id: string } {
    const xmlUrl = input.xmlUrl.trim();
    const id = feedIdFromUrl(xmlUrl);
    const now = new Date().toISOString();
    this.upsertFeedRow({
      id,
      title: input.title?.trim() || new URL(xmlUrl).hostname.replace(/^www\./, ""),
      xmlUrl,
      folderId: input.folderId ?? null,
      sortOrder: 0,
      nextPollAt: now,
    });
    return { id };
  }

  removeFeed(feedId: string): boolean {
    const r = this.db.prepare("DELETE FROM feeds WHERE id = ?").run(feedId);
    this.dirty = true;
    return Number(r.changes) > 0;
  }

  moveFeed(feedId: string, folderId: string | null): boolean {
    const r = this.db.prepare("UPDATE feeds SET folder_id = ? WHERE id = ?").run(folderId, feedId);
    this.dirty = true;
    return Number(r.changes) > 0;
  }

  createFolder(name: string, parentId: string | null = null): { id: string } {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("folder name required");
    const path = parentId ? [...this.folderPathSegments(parentId), trimmed] : [trimmed];
    const id = folderIdFromPath(path);
    const orderRow = parentId
      ? (this.db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM folders WHERE parent_id = ?").get(parentId) as {
          n: number;
        })
      : (this.db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM folders WHERE parent_id IS NULL").get() as { n: number });
    const order = Number(orderRow.n) || 0;
    this.db
      .prepare(`INSERT INTO folders (id, parent_id, name, sort_order) VALUES (?, ?, ?, ?)`)
      .run(id, parentId, trimmed, order);
    this.dirty = true;
    return { id };
  }

  renameFolder(folderId: string, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const r = this.db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(trimmed, folderId);
    this.dirty = true;
    return Number(r.changes) > 0;
  }

  deleteFolder(folderId: string): boolean {
    const exists = this.db.prepare("SELECT 1 FROM folders WHERE id = ?").get(folderId);
    if (!exists) return false;
    this.db.prepare("UPDATE feeds SET folder_id = NULL WHERE folder_id = ?").run(folderId);
    this.db.prepare("UPDATE folders SET parent_id = NULL WHERE parent_id = ?").run(folderId);
    const r = this.db.prepare("DELETE FROM folders WHERE id = ?").run(folderId);
    this.dirty = true;
    return Number(r.changes) > 0;
  }

  private folderPathSegments(folderId: string): string[] {
    const segments: string[] = [];
    let current: string | null = folderId;
    while (current) {
      const row = this.db.prepare("SELECT id, parent_id, name FROM folders WHERE id = ?").get(current) as
        | { id: string; parent_id: string | null; name: string }
        | undefined;
      if (!row) break;
      segments.unshift(row.name);
      current = row.parent_id;
    }
    return segments;
  }

  feedIdsInFolderIds(folderIds: string[]): string[] {
    if (!folderIds.length) return [];
    const placeholders = folderIds.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT id FROM feeds WHERE folder_id IN (${placeholders})`).all(...folderIds) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  folderIdsWithDescendants(folderId: string): string[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE sub AS (
           SELECT id FROM folders WHERE id = ?
           UNION ALL
           SELECT f.id FROM folders f INNER JOIN sub ON f.parent_id = sub.id
         )
         SELECT id FROM sub`,
      )
      .all(folderId) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  dueFeeds(now: Date, limit: number): FeedRow[] {
    const iso = now.toISOString();
    const rows = this.db
      .prepare(
        `SELECT id, folder_id, title, xml_url, html_url, etag, last_modified, is_hn
         FROM feeds WHERE next_poll_at <= ? ORDER BY next_poll_at LIMIT ?`,
      )
      .all(iso, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      folderId: r.folder_id ? String(r.folder_id) : null,
      title: String(r.title),
      xmlUrl: String(r.xml_url),
      htmlUrl: r.html_url ? String(r.html_url) : null,
      etag: r.etag ? String(r.etag) : undefined,
      lastModified: r.last_modified ? String(r.last_modified) : undefined,
      isHn: Number(r.is_hn) === 1,
    }));
  }

  recordFetchSuccess(feedId: string, now: Date, meta: { etag?: string; lastModified?: string; notModified?: boolean }) {
    const interval = POLL.defaultIntervalMs;
    const next = new Date(now.getTime() + interval).toISOString();
    this.db
      .prepare(
        `UPDATE feeds SET last_fetch_at = ?, last_error = NULL, fail_streak = 0,
         etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified), next_poll_at = ? WHERE id = ?`,
      )
      .run(now.toISOString(), meta.etag ?? null, meta.lastModified ?? null, next, feedId);
    this.dirty = true;
  }

  recordFetchError(feedId: string, message: string, now: Date) {
    const row = this.db.prepare("SELECT fail_streak FROM feeds WHERE id = ?").get(feedId) as { fail_streak: number } | undefined;
    const streak = (row?.fail_streak ?? 0) + 1;
    const backoff = Math.min(POLL.minIntervalMs * 2 ** streak, POLL.maxBackoffMs);
    const next = new Date(now.getTime() + backoff).toISOString();
    this.db
      .prepare(`UPDATE feeds SET last_fetch_at = ?, last_error = ?, fail_streak = ?, next_poll_at = ? WHERE id = ?`)
      .run(now.toISOString(), message.slice(0, 500), streak, next, feedId);
    this.dirty = true;
  }

  ingestParsed(feedId: string, incoming: ParsedItem[], now: Date): IngestResult {
    if (!this.db.prepare("SELECT 1 FROM feeds WHERE id = ?").get(feedId)) {
      const isHn = feedId === HN_FEED_ID;
      this.upsertFeedRow({
        id: feedId,
        title: isHn ? "Hacker News" : feedId.replace(/^https?:\/\//, "").slice(0, 80),
        xmlUrl: isHn ? HN_API_URL : feedId,
        isHn,
        sortOrder: 0,
        nextPollAt: now.toISOString(),
      });
    }
    const nowIso = now.toISOString();
    let added = 0;
    const ids: string[] = [];
    for (const raw of incoming) {
      if (!raw.title) continue;
      const id = itemId(feedId, raw.link, raw.title);
      const exists = this.db.prepare("SELECT 1 FROM entries WHERE id = ?").get(id);
      if (exists) continue;
      this.db
        .prepare(
          `INSERT INTO entries (id, feed_id, guid, link, title, snippet, content_html, thumb_url, duration_sec, published_at, first_seen_at, read_at, starred)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)`,
        )
        .run(
          id,
          feedId,
          raw.guid ?? raw.link ?? raw.title,
          raw.link ?? null,
          raw.title,
          raw.summary ?? raw.meta ?? null,
          raw.contentHtml ?? null,
          raw.thumbUrl ?? null,
          raw.durationSec ?? null,
          raw.date ?? null,
          nowIso,
        );
      if (this.fts5) {
        const feedTitle = String(this.db.prepare("SELECT title FROM feeds WHERE id = ?").get(feedId)?.title ?? "");
        this.db.prepare("INSERT INTO entry_fts (entry_id, title, snippet, feed_title) VALUES (?, ?, ?, ?)").run(
          id,
          raw.title,
          raw.summary ?? "",
          feedTitle,
        );
      }
      added++;
      ids.push(id);
    }
    this.dirty = true;
    return { added, ids };
  }

  private insertEntry(feedId: string, raw: { title: string; link?: string; guid?: string; summary?: string; date?: string }, firstSeenAt: string, read: boolean) {
    const id = itemId(feedId, raw.link, raw.title);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO entries (id, feed_id, guid, link, title, snippet, published_at, first_seen_at, read_at, starred)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(id, feedId, raw.guid ?? raw.link ?? raw.title, raw.link ?? null, raw.title, raw.summary ?? null, raw.date ?? null, firstSeenAt, read ? firstSeenAt : null);
  }

  ingest(feedId: string, incoming: Array<{ title: string; link?: string; summary?: string; date?: string; meta?: string }>, now: Date): number {
    return this.ingestParsed(
      feedId,
      incoming.map((x) => ({ ...x, guid: x.link || x.title })),
      now,
    ).added;
  }

  setFeedError(feedId: string, message: string, now: Date): void {
    this.recordFetchError(feedId, message, now);
  }

  runRetention(now = new Date()): void {
    const feeds = this.db.prepare("SELECT id FROM feeds").all() as Array<{ id: string }>;
    for (const { id } of feeds) {
      const ids = this.db
        .prepare(`SELECT id FROM entries WHERE feed_id = ? ORDER BY first_seen_at DESC LIMIT -1 OFFSET ?`)
        .all(id, RETENTION.perFeed) as Array<{ id: string }>;
      for (const row of ids) {
        this.db.prepare("DELETE FROM entries WHERE id = ?").run(row.id);
        if (this.fts5) this.db.prepare("DELETE FROM entry_fts WHERE entry_id = ?").run(row.id);
      }
    }
    const global = this.db
      .prepare(`SELECT id FROM entries WHERE starred = 0 ORDER BY first_seen_at ASC LIMIT -1 OFFSET ?`)
      .all(RETENTION.global) as Array<{ id: string }>;
    for (const row of global) {
      this.db.prepare("DELETE FROM entries WHERE id = ?").run(row.id);
      if (this.fts5) this.db.prepare("DELETE FROM entry_fts WHERE entry_id = ?").run(row.id);
    }
    const cutoffUnread = new Date(now.getTime() - RETENTION.unreadMaxAgeDays * 86400_000).toISOString();
    this.db.prepare(`DELETE FROM entries WHERE starred = 0 AND read_at IS NULL AND first_seen_at < ?`).run(cutoffUnread);
    const cutoffHtml = new Date(now.getTime() - RETENTION.contentHtmlMaxAgeDays * 86400_000).toISOString();
    this.db.prepare(`UPDATE entries SET content_html = NULL WHERE starred = 0 AND first_seen_at < ? AND content_html IS NOT NULL`).run(cutoffHtml);
    this.dirty = true;
  }

  private rowToItem(r: Record<string, unknown>): StoredItem {
    return {
      id: String(r.id),
      feedId: String(r.feed_id),
      title: String(r.title),
      link: r.link ? String(r.link) : undefined,
      summary: r.snippet ? String(r.snippet) : undefined,
      publishedAt: r.published_at ? String(r.published_at) : undefined,
      firstSeenAt: String(r.first_seen_at),
      read: r.read_at != null,
      starred: Number(r.starred) === 1,
      thumbUrl: r.thumb_url ? String(r.thumb_url) : undefined,
      durationSec: r.duration_sec != null ? Number(r.duration_sec) : undefined,
      feedTitle: r.feed_title ? String(r.feed_title) : undefined,
      contentHtml: r.content_html ? String(r.content_html) : undefined,
    };
  }

  list(
    opts: {
      unreadOnly?: boolean;
      limit?: number;
      feedId?: string;
      folderId?: string;
      feedIds?: string[];
      starred?: boolean;
      q?: string;
    } = {},
  ): StoredItem[] {
    const limit = opts.limit ?? 200;
    const params: unknown[] = [];
    const where: string[] = [];
    if (opts.unreadOnly) where.push("e.read_at IS NULL");
    if (opts.feedId) {
      where.push("e.feed_id = ?");
      params.push(opts.feedId);
    }
    if (opts.folderId) {
      const ids = this.folderIdsWithDescendants(opts.folderId);
      where.push(`f.folder_id IN (${ids.map(() => "?").join(",")})`);
      params.push(...ids);
    }
    if (opts.feedIds) {
      if (!opts.feedIds.length) return [];
      where.push(`e.feed_id IN (${opts.feedIds.map(() => "?").join(",")})`);
      params.push(...opts.feedIds);
    }
    if (opts.starred) where.push("e.starred = 1");
    if (opts.q?.trim()) {
      const q = opts.q.trim();
      if (this.fts5) {
        where.push("e.id IN (SELECT entry_id FROM entry_fts WHERE entry_fts MATCH ?)");
        params.push(q.replace(/"/g, '""').split(/\s+/).map((t) => `"${t}"*`).join(" AND "));
      } else {
        const like = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
        where.push("(e.title LIKE ? ESCAPE '\\' OR e.snippet LIKE ? ESCAPE '\\' OR f.title LIKE ? ESCAPE '\\')");
        params.push(like, like, like);
      }
    }
    const sql = `SELECT e.*, f.title AS feed_title FROM entries e
      JOIN feeds f ON f.id = e.feed_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY e.first_seen_at DESC LIMIT ?`;
    params.push(limit);
    const rows = this.db.prepare(sql).all(...(params as Array<string | number>)) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToItem(r));
  }

  getEntry(id: string): StoredItem | undefined {
    const r = this.db
      .prepare(`SELECT e.*, f.title AS feed_title FROM entries e JOIN feeds f ON f.id = e.feed_id WHERE e.id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return r ? this.rowToItem(r) : undefined;
  }

  unreadSince(sinceIso: string): StoredItem[] {
    const rows = this.db
      .prepare(
        `SELECT e.*, f.title AS feed_title FROM entries e JOIN feeds f ON f.id = e.feed_id
         WHERE e.read_at IS NULL AND e.first_seen_at >= ? ORDER BY e.first_seen_at DESC`,
      )
      .all(sinceIso) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToItem(r));
  }

  itemsForBriefing(sinceIso: string, limit = 40, feedIds?: string[] | null): StoredItem[] {
    if (feedIds && !feedIds.length) return [];
    const params: unknown[] = [sinceIso];
    let feedFilter = "";
    if (feedIds) {
      feedFilter = ` AND e.feed_id IN (${feedIds.map(() => "?").join(",")})`;
      params.push(...feedIds);
    }
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT e.*, f.title AS feed_title FROM entries e JOIN feeds f ON f.id = e.feed_id
         WHERE e.first_seen_at >= ?${feedFilter} ORDER BY e.first_seen_at DESC LIMIT ?`,
      )
      .all(...(params as Array<string | number>)) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToItem(r));
  }

  markRead(ids: string[]): number {
    const now = new Date().toISOString();
    let n = 0;
    const stmt = this.db.prepare(`UPDATE entries SET read_at = ? WHERE id = ? AND read_at IS NULL`);
    for (const id of ids) {
      const r = stmt.run(now, id);
      n += Number(r.changes);
    }
    this.dirty = true;
    return n;
  }

  markAllRead(scope?: { feedId?: string; folderId?: string }): number {
    const now = new Date().toISOString();
    if (scope?.feedId) {
      const r = this.db.prepare(`UPDATE entries SET read_at = ? WHERE feed_id = ? AND read_at IS NULL`).run(now, scope.feedId);
      this.dirty = true;
      return Number(r.changes);
    }
    if (scope?.folderId) {
      const ids = this.folderIdsWithDescendants(scope.folderId);
      const placeholders = ids.map(() => "?").join(",");
      const r = this.db
        .prepare(
          `UPDATE entries SET read_at = ? WHERE read_at IS NULL AND feed_id IN (SELECT id FROM feeds WHERE folder_id IN (${placeholders}))`,
        )
        .run(now, ...ids);
      this.dirty = true;
      return Number(r.changes);
    }
    const r = this.db.prepare(`UPDATE entries SET read_at = ? WHERE read_at IS NULL`).run(now);
    this.dirty = true;
    return Number(r.changes);
  }

  setStarred(id: string, starred: boolean): boolean {
    const r = this.db.prepare(`UPDATE entries SET starred = ? WHERE id = ?`).run(starred ? 1 : 0, id);
    this.dirty = true;
    return Number(r.changes) > 0;
  }

  statuses(feedIds: string[]): FeedStatus[] {
    return feedIds.map((feedId) => ({
      feedId,
      lastFetchAt: (this.db.prepare("SELECT last_fetch_at FROM feeds WHERE id = ?").get(feedId) as { last_fetch_at?: string })?.last_fetch_at,
      lastError: (this.db.prepare("SELECT last_error FROM feeds WHERE id = ?").get(feedId) as { last_error?: string })?.last_error,
      itemCount: Number(this.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE feed_id = ?").get(feedId)?.n ?? 0),
    }));
  }

  tree(): {
    unreadTotal: number;
    folders: FolderTreeNode[];
    rootFeeds: Array<{ id: string; title: string; unread: number }>;
    folderOptions: Array<{ id: string; label: string }>;
  } {
    const unreadRow = this.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE read_at IS NULL").get() as { n: number | bigint };
    const unreadTotal = Number(unreadRow.n);
    const folders = this.db.prepare("SELECT id, parent_id, name FROM folders ORDER BY sort_order, name").all() as Array<{
      id: string;
      parent_id: string | null;
      name: string;
    }>;
    const feeds = this.db.prepare("SELECT id, folder_id, title FROM feeds ORDER BY sort_order, title").all() as Array<{
      id: string;
      folder_id: string | null;
      title: string;
    }>;
    const unreadFor = (feedId: string) => {
      const row = this.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE feed_id = ? AND read_at IS NULL").get(feedId) as {
        n: number | bigint;
      };
      return Number(row.n);
    };
    const build = (parentId: string | null, depth: number): FolderTreeNode[] =>
      folders
        .filter((f) => (f.parent_id ?? null) === parentId)
        .map((f) => {
          const childFolders = build(f.id, depth + 1);
          const directFeeds = feeds
            .filter((x) => x.folder_id === f.id)
            .map((x) => ({ id: x.id, title: x.title, unread: unreadFor(x.id) }));
          const childUnread = childFolders.reduce((s, c) => s + c.unread, 0);
          const feedUnread = directFeeds.reduce((s, x) => s + x.unread, 0);
          return {
            id: f.id,
            name: f.name,
            parentId: f.parent_id,
            unread: feedUnread + childUnread,
            feeds: directFeeds,
            folders: childFolders,
          };
        });
    const roots = build(null, 0);
    const folderOptions: Array<{ id: string; label: string }> = [];
    const walkOpts = (nodes: FolderTreeNode[], prefix: string) => {
      for (const n of nodes) {
        const label = prefix ? `${prefix} / ${n.name}` : n.name;
        folderOptions.push({ id: n.id, label });
        walkOpts(n.folders, label);
      }
    };
    walkOpts(roots, "");
    return {
      unreadTotal,
      folders: roots,
      rootFeeds: feeds.filter((x) => !x.folder_id).map((x) => ({ id: x.id, title: x.title, unread: unreadFor(x.id) })),
      folderOptions,
    };
  }

  usesFts5(): boolean {
    return this.fts5;
  }
}
