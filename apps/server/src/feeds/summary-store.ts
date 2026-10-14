import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { sanitizeSummaryText } from "./summary-text";

export interface StoredSummary {
  id: string;
  entryId: string | null;
  url: string | null;
  title: string;
  feedName: string | null;
  folderName: string | null;
  summary: string;
  model: string;
  createdAt: string;
  entryExists: boolean;
}

export const DEFAULT_SUMMARIZE_MAX_PER_HOUR = 10;

export function summaryDedupeKey(entryId: string | null, url: string | null, title: string): string {
  if (entryId) return `entry:${entryId}`;
  return createHash("sha256").update(`${url ?? ""}\0${title}`).digest("hex").slice(0, 32);
}

export class SummaryStore {
  constructor(
    private db: DatabaseSync,
    private fts5: boolean,
    private entryExists: (id: string) => boolean,
  ) {}

  countSince(sinceIso: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM summaries WHERE created_at >= ?").get(sinceIso) as { n: number | bigint };
    return Number(row.n);
  }

  findByDedupeKey(key: string): StoredSummary | undefined {
    const r = this.db.prepare("SELECT * FROM summaries WHERE dedupe_key = ?").get(key) as Record<string, unknown> | undefined;
    return r ? this.rowToSummary(r) : undefined;
  }

  findByEntryId(entryId: string): StoredSummary | undefined {
    const r = this.db.prepare("SELECT * FROM summaries WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1").get(entryId) as
      | Record<string, unknown>
      | undefined;
    return r ? this.rowToSummary(r) : undefined;
  }

  insert(row: {
    entryId: string | null;
    url: string | null;
    title: string;
    feedName: string | null;
    folderName: string | null;
    summary: string;
    model: string;
    createdAt: string;
  }): StoredSummary {
    const dedupeKey = summaryDedupeKey(row.entryId, row.url, row.title);
    const existing = this.findByDedupeKey(dedupeKey);
    if (existing) return existing;
    const id = randomUUID();
    const summary = sanitizeSummaryText(row.summary);
    this.db
      .prepare(
        `INSERT INTO summaries (id, entry_id, dedupe_key, url, title, feed_name, folder_name, summary, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        row.entryId,
        dedupeKey,
        row.url,
        row.title,
        row.feedName,
        row.folderName,
        summary,
        row.model,
        row.createdAt,
      );
    if (this.fts5) {
      this.db.prepare("INSERT INTO summary_fts (summary_id, title, summary, feed_name, folder_name) VALUES (?, ?, ?, ?, ?)").run(
        id,
        row.title,
        summary,
        row.feedName ?? "",
        row.folderName ?? "",
      );
    }
    return this.get(id)!;
  }

  get(id: string): StoredSummary | undefined {
    const r = this.db.prepare("SELECT * FROM summaries WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return r ? this.rowToSummary(r) : undefined;
  }

  list(opts: { q?: string; limit?: number } = {}): StoredSummary[] {
    const limit = opts.limit ?? 100;
    const params: Array<string | number> = [];
    let sql = "SELECT * FROM summaries";
    if (opts.q?.trim()) {
      const q = opts.q.trim();
      if (this.fts5) {
        sql += " WHERE id IN (SELECT summary_id FROM summary_fts WHERE summary_fts MATCH ?)";
        params.push(q.replace(/"/g, '""').split(/\s+/).map((t) => `"${t}"*`).join(" AND "));
      } else {
        sql += " WHERE title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR feed_name LIKE ? ESCAPE '\\'";
        const like = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
        params.push(like, like, like);
      }
    }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToSummary(r));
  }

  private rowToSummary(r: Record<string, unknown>): StoredSummary {
    const entryId = r.entry_id ? String(r.entry_id) : null;
    return {
      id: String(r.id),
      entryId,
      url: r.url ? String(r.url) : null,
      title: String(r.title),
      feedName: r.feed_name ? String(r.feed_name) : null,
      folderName: r.folder_name ? String(r.folder_name) : null,
      summary: String(r.summary),
      model: String(r.model),
      createdAt: String(r.created_at),
      entryExists: entryId ? this.entryExists(entryId) : false,
    };
  }
}
