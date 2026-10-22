import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATABASE_FILE, initSchema } from "../database";
import type { HobieQueueStore, HobieTask } from "../stores/hobie-queue";
import type { WinsStore } from "../wins/store";
import { validDay } from "../calendar/store";
import {
  BOARD_COLUMNS,
  type BoardCard,
  type BoardColumn,
  DONE,
  READY_FOR_HOBIE,
  WAITING,
  type CardMoveEvent,
} from "./types";

export class BoardConflictError extends Error {}
export interface CardPlanningInput {
  estimatedMinutes?: unknown;
  dueDate?: unknown;
  priority?: unknown;
}
function cardPlanning(input: CardPlanningInput, card?: BoardCard) {
  const estimatedMinutes = input.estimatedMinutes === undefined ? card?.estimatedMinutes ?? null : input.estimatedMinutes;
  const dueDate = input.dueDate === undefined ? card?.dueDate ?? null : input.dueDate;
  const priority = input.priority === undefined ? card?.priority ?? "normal" : input.priority;
  if (estimatedMinutes !== null && (typeof estimatedMinutes !== "number" || !Number.isInteger(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 1440)) throw new Error("Estimate must be a whole number of minutes from 1 to 1440, or null");
  if (dueDate !== null && !validDay(dueDate)) throw new Error("Due date must be a real YYYY-MM-DD date, or null");
  if (priority !== "low" && priority !== "normal" && priority !== "high") throw new Error("Priority must be low, normal, or high");
  return { estimatedMinutes, dueDate, priority };
}

const MAX_TITLE = 200;
const MAX_NOTES = 8_000;

function isColumn(c: string): c is BoardColumn {
  return (BOARD_COLUMNS as readonly string[]).includes(c);
}

function rowToCard(r: Record<string, unknown>): BoardCard {
  return {
    id: String(r.id),
    title: String(r.title),
    notes: String(r.notes ?? ""),
    column: String(r.column) as BoardColumn,
    position: Number(r.position),
    hobieTaskId: r.hobie_task_id ? String(r.hobie_task_id) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    estimatedMinutes: r.estimated_minutes == null ? null : Number(r.estimated_minutes),
    dueDate: r.due_date == null ? null : String(r.due_date),
    priority: String(r.priority) as BoardCard["priority"],
    version: Number(r.version),
  };
}

export class BoardStore {
  private constructor(private db: DatabaseSync) {}

  static open(dataDir: string): BoardStore {
    const db = new DatabaseSync(join(dataDir, DATABASE_FILE));
    initSchema(db);
    return new BoardStore(db);
  }

  close(): void {
    this.db.close();
  }

  list(): BoardCard[] {
    const rows = this.db
      .prepare(`SELECT * FROM cards ORDER BY column, position, created_at`)
      .all() as Record<string, unknown>[];
    return rows.map(rowToCard);
  }

  columnCounts(): Record<BoardColumn, number> {
    const counts = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, 0])) as Record<BoardColumn, number>;
    const rows = this.db.prepare(`SELECT column, COUNT(*) AS n FROM cards GROUP BY column`).all() as {
      column: string;
      n: number | bigint;
    }[];
    for (const r of rows) {
      if (isColumn(r.column)) counts[r.column] = Number(r.n);
    }
    return counts;
  }

  get(id: string): BoardCard | undefined {
    const r = this.db.prepare(`SELECT * FROM cards WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return r ? rowToCard(r) : undefined;
  }

  byHobieTaskId(taskId: string): BoardCard | undefined {
    const r = this.db.prepare(`SELECT * FROM cards WHERE hobie_task_id = ?`).get(taskId) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToCard(r) : undefined;
  }

  checkVersion(id: string, expected: unknown): void {
    const card = this.get(id);
    if (!card || expected !== card.version) throw new BoardConflictError("This Board card changed elsewhere. Refresh before editing; your changes have not been applied.");
  }

  updateMeta(id: string, opts: { title?: string; notes?: string } & CardPlanningInput): BoardCard | undefined {
    const card = this.get(id);
    if (!card) return undefined;
    const title = opts.title !== undefined ? String(opts.title).trim().slice(0, MAX_TITLE) : card.title;
    if (!title) throw new Error("title is required");
    let notes = opts.notes !== undefined ? String(opts.notes).trim() : card.notes;
    if (notes.length > MAX_NOTES) notes = notes.slice(0, MAX_NOTES);
    const planning = cardPlanning(opts, card);
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE cards SET title = ?, notes = ?, estimated_minutes = ?, due_date = ?, priority = ?, version = version + 1, updated_at = ? WHERE id = ?`)
      .run(title, notes, planning.estimatedMinutes, planning.dueDate, planning.priority, now, id);
    return this.get(id);
  }

  create(opts: { title: string; notes?: string; column?: BoardColumn } & CardPlanningInput): BoardCard {
    const title = String(opts.title ?? "").trim().slice(0, MAX_TITLE);
    if (!title) throw new Error("title is required");
    let notes = String(opts.notes ?? "").trim();
    if (notes.length > MAX_NOTES) notes = notes.slice(0, MAX_NOTES);
    const column = opts.column && isColumn(opts.column) ? opts.column : "Backlog";
    const now = new Date().toISOString();
    const position = this.nextPosition(column);
    const id = randomUUID();
    const planning = cardPlanning(opts);
    this.db
      .prepare(
        `INSERT INTO cards (id, title, notes, column, position, hobie_task_id, created_at, updated_at, estimated_minutes, due_date, priority)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      )
      .run(id, title, notes, column, position, now, now, planning.estimatedMinutes, planning.dueDate, planning.priority);
    if (column !== "Backlog") this.recordEvent(id, null, column, now);
    return this.get(id)!;
  }

  async move(
    id: string,
    toColumn: BoardColumn,
    opts: {
      position?: number;
      hobieQueue?: HobieQueueStore;
      maxHobiePending?: number;
      wins?: WinsStore;
    } = {},
  ): Promise<BoardCard | undefined> {
    if (!isColumn(toColumn)) throw new Error("invalid column");
    const card = this.get(id);
    if (!card) return undefined;
    if (card.column === toColumn && opts.position === undefined) return card;

    const now = new Date().toISOString();
    let hobieTaskId = card.hobieTaskId;
    const fromCol = card.column;

    if (toColumn === READY_FOR_HOBIE && !hobieTaskId) {
      if (!opts.hobieQueue) throw new Error("Hobie queue unavailable");
      const task = await opts.hobieQueue.enqueue(
        { clientId: "board", title: card.title, body: card.notes, urgent: false },
        opts.maxHobiePending ?? 20,
      );
      hobieTaskId = task.id;
      this.db.prepare(`UPDATE cards SET hobie_task_id = ?, updated_at = ? WHERE id = ?`).run(hobieTaskId, now, id);
    }

    const position = opts.position ?? this.nextPosition(toColumn, id);
    this.db
      .prepare(`UPDATE cards SET column = ?, position = ?, hobie_task_id = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
      .run(toColumn, position, hobieTaskId, now, id);

    if (fromCol !== toColumn) this.recordEvent(id, fromCol, toColumn, now);

    if (toColumn === DONE && opts.wins) {
      opts.wins.addFromCard(id, card.title, now);
    }

    return this.get(id);
  }

  resolveCardForTask(task: HobieTask): BoardCard | undefined {
    const linked = this.byHobieTaskId(task.id);
    if (linked) return linked;
    const row = this.db
      .prepare(
        `SELECT * FROM cards WHERE column = ? AND (hobie_task_id IS NULL OR hobie_task_id = '') AND title = ? LIMIT 1`,
      )
      .get(READY_FOR_HOBIE, task.title) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const at = new Date().toISOString();
    this.db.prepare(`UPDATE cards SET hobie_task_id = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(task.id, at, String(row.id));
    return this.get(String(row.id));
  }

  async onHobieClaimed(task: HobieTask): Promise<BoardCard | undefined> {
    const card = this.resolveCardForTask(task);
    if (!card || card.column === WAITING || card.column === DONE) return card;
    return this.move(card.id, WAITING);
  }

  async onHobieDone(task: HobieTask, wins: WinsStore): Promise<BoardCard | undefined> {
    const card = this.resolveCardForTask(task);
    if (!card) return undefined;
    if (card.column === DONE) return card;
    return this.move(card.id, DONE, { wins });
  }

  blockedOnMe(): BoardCard[] {
    return this.list().filter((c) => c.column === "Blocked on me");
  }

  movesSince(isoSince: string): CardMoveEvent[] {
    const rows = this.db
      .prepare(
        `SELECT e.card_id, e.from_col, e.to_col, e.at, c.title
         FROM card_events e
         JOIN cards c ON c.id = e.card_id
         WHERE e.at >= ?
         ORDER BY e.at DESC`,
      )
      .all(isoSince) as { card_id: string; from_col: string | null; to_col: string; at: string; title: string }[];
    return rows.map((r) => ({
      cardId: r.card_id,
      fromCol: r.from_col && isColumn(r.from_col) ? r.from_col : null,
      toCol: r.to_col as BoardColumn,
      at: r.at,
      title: r.title,
    }));
  }

  private nextPosition(column: BoardColumn, excludeId?: string): number {
    const row = this.db
      .prepare(`SELECT MAX(position) AS m FROM cards WHERE column = ? AND id != ?`)
      .get(column, excludeId ?? "") as { m: number | bigint | null };
    return (row.m == null ? 0 : Number(row.m)) + 1;
  }

  private recordEvent(cardId: string, fromCol: BoardColumn | null, toCol: BoardColumn, at: string): void {
    this.db
      .prepare(`INSERT INTO card_events (card_id, from_col, to_col, at) VALUES (?, ?, ?, ?)`)
      .run(cardId, fromCol, toCol, at);
  }
}
