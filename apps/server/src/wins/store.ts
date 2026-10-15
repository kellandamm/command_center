import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../feeds/schema";
import type { Win, WinSource } from "./types";

function rowToWin(r: Record<string, unknown>): Win {
  return {
    id: String(r.id),
    source: String(r.source) as WinSource,
    ref: String(r.ref),
    title: String(r.title),
    at: String(r.at),
  };
}

export class WinsStore {
  private constructor(private db: DatabaseSync) {}

  static open(dataDir: string): WinsStore {
    const db = new DatabaseSync(join(dataDir, "rss.sqlite"));
    initSchema(db);
    return new WinsStore(db);
  }

  list(limit = 500): Win[] {
    const rows = this.db
      .prepare(`SELECT * FROM wins ORDER BY at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToWin);
  }

  add(opts: { source: WinSource; ref: string; title: string; at?: string }): Win | null {
    const title = String(opts.title ?? "").trim().slice(0, 300);
    if (!title) return null;
    const ref = String(opts.ref ?? "").trim();
    if (!ref) return null;
    const at = opts.at ?? new Date().toISOString();
    const existing = this.db
      .prepare(`SELECT id FROM wins WHERE source = ? AND ref = ?`)
      .get(opts.source, ref) as { id: string } | undefined;
    if (existing) return this.getByRef(opts.source, ref)!;

    const id = randomUUID();
    try {
      this.db.prepare(`INSERT INTO wins (id, source, ref, title, at) VALUES (?, ?, ?, ?, ?)`).run(
        id,
        opts.source,
        ref,
        title,
        at,
      );
    } catch {
      return this.getByRef(opts.source, ref) ?? null;
    }
    return { id, source: opts.source, ref, title, at };
  }

  addFromCard(cardId: string, title: string, at?: string): Win | null {
    return this.add({ source: "card", ref: cardId, title, at });
  }

  getByRef(source: WinSource, ref: string): Win | undefined {
    const r = this.db.prepare(`SELECT * FROM wins WHERE source = ? AND ref = ?`).get(source, ref) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToWin(r) : undefined;
  }

  between(isoStart: string, isoEnd: string): Win[] {
    const rows = this.db
      .prepare(`SELECT * FROM wins WHERE at >= ? AND at < ? ORDER BY at DESC`)
      .all(isoStart, isoEnd) as Record<string, unknown>[];
    return rows.map(rowToWin);
  }

  getWeekSummary(isoWeek: string): { summary: string; model: string; createdAt: string } | undefined {
    const r = this.db.prepare(`SELECT summary, model, created_at FROM win_week_summaries WHERE iso_week = ?`).get(isoWeek) as
      | { summary: string; model: string; created_at: string }
      | undefined;
    if (!r) return undefined;
    return { summary: r.summary, model: r.model, createdAt: r.created_at };
  }

  saveWeekSummary(isoWeek: string, summary: string, model: string, createdAt: string): void {
    this.db
      .prepare(
        `INSERT INTO win_week_summaries (iso_week, summary, model, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(iso_week) DO UPDATE SET summary = excluded.summary, model = excluded.model, created_at = excluded.created_at`,
      )
      .run(isoWeek, summary, model, createdAt);
  }

  countSummariesSince(sinceIso: string): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM win_week_summaries WHERE created_at >= ?`).get(sinceIso) as {
      n: number | bigint;
    };
    return Number(row.n);
  }
}

export function isoWeekKey(d: Date): string {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function groupWinsByIsoWeek(wins: Win[]): Map<string, Win[]> {
  const map = new Map<string, Win[]>();
  for (const w of wins) {
    const key = isoWeekKey(new Date(w.at));
    const list = map.get(key) ?? [];
    list.push(w);
    map.set(key, list);
  }
  return map;
}
