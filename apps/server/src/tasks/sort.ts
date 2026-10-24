import { DONE, type BoardCard } from "../board/types";

const PRIORITY_RANK: Record<BoardCard["priority"], number> = { high: 0, normal: 1, low: 2 };

export interface TaskScheduleHint {
  cardId: string;
  /** ISO start of earliest upcoming time block, if any. */
  blockStart: string | null;
}

export type TaskFilter =
  | "all"
  | "due-soon"
  | "high"
  | `column:${string}`;

export function compareDashboardTasks(
  a: BoardCard,
  b: BoardCard,
  blockStart: (id: string) => string | null,
): number {
  const dueA = a.dueDate;
  const dueB = b.dueDate;
  if (dueA !== dueB) {
    if (!dueA) return 1;
    if (!dueB) return -1;
    if (dueA < dueB) return -1;
    if (dueA > dueB) return 1;
  }
  const startA = blockStart(a.id);
  const startB = blockStart(b.id);
  if (startA !== startB) {
    if (!startA) return 1;
    if (!startB) return -1;
    if (startA < startB) return -1;
    if (startA > startB) return 1;
  }
  const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (pr !== 0) return pr;
  if (a.createdAt < b.createdAt) return -1;
  if (a.createdAt > b.createdAt) return 1;
  return 0;
}

export function dueSoonCutoff(todayYmd: string): string {
  const d = new Date(`${todayYmd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 10);
}

export function matchesTaskFilter(card: BoardCard, filter: TaskFilter, todayYmd: string): boolean {
  if (card.column === DONE) return false;
  if (filter === "all") return true;
  if (filter === "high") return card.priority === "high";
  if (filter === "due-soon") {
    if (!card.dueDate) return false;
    const cutoff = dueSoonCutoff(todayYmd);
    return card.dueDate <= cutoff;
  }
  if (filter.startsWith("column:")) return card.column === filter.slice(7);
  return true;
}

export function sortDashboardTasks(
  cards: BoardCard[],
  blockStart: (id: string) => string | null,
  filter: TaskFilter,
  todayYmd: string,
): BoardCard[] {
  return cards
    .filter((c) => matchesTaskFilter(c, filter, todayYmd))
    .sort((a, b) => compareDashboardTasks(a, b, blockStart));
}
