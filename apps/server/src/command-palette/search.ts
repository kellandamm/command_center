import type { AuthResult } from "../auth";
import type { BookmarksStore } from "../bookmarks/store";
import type { BoardStore } from "../board/store";
import type { BudgetStore } from "../budget/store";
import { budgetAvailable } from "../budget/gate";
import { isBudgetOwner } from "../budget/owner-access";
import type { Config } from "../config";
import { AGENT_SUB_NAV } from "../agent-sub-nav";
import { MEETING_TAG } from "../meetings/constants";
import type { NotesStore } from "../notes/store";
import { isNoteSensitive } from "../notes/sensitive";
import { visibleNavTabs } from "../nav-tabs";
import type { SettingsStore } from "../settings";
import type { TodoistOpenTaskCache } from "./todoist-cache";

export type CommandPaletteRowType =
  | "note"
  | "task"
  | "board-card"
  | "bookmark"
  | "meeting"
  | "nav"
  | "budget-tx";

export interface CommandPaletteRow {
  id: string;
  type: CommandPaletteRowType;
  title: string;
  subtitle?: string;
  href: string;
  score: number;
}

export interface CommandPaletteSearchDeps {
  query: string;
  limit?: number;
  cfg: Config;
  settings: SettingsStore;
  notes: NotesStore;
  bookmarks: BookmarksStore;
  board: BoardStore;
  budget?: BudgetStore;
  who: AuthResult & { ok: true };
  todoistCache: TodoistOpenTaskCache;
  /** Test-only: skip owner gate for budget rows (revert-guard tests). */
  testIncludeBudgetWithoutOwner?: boolean;
}

const MAX_LIMIT = 50;

/** Exported for unit tests (ranking). */
export function scoreTextMatch(text: string, needle: string): number {
  const n = needle.trim().toLowerCase();
  if (!n) return 0;
  const h = text.toLowerCase();
  const idx = h.indexOf(n);
  if (idx < 0) return -1;
  let score = 200 - Math.min(idx, 150);
  if (h.startsWith(n)) score += 80;
  if (idx === 0 || /\s/.test(h.charAt(idx - 1))) score += 30;
  if (h.length === n.length) score += 40;
  return score;
}

function row(id: string, type: CommandPaletteRowType, title: string, href: string, score: number, subtitle?: string): CommandPaletteRow {
  return { id, type, title, subtitle, href, score };
}

function navRows(cfg: Config, settings: SettingsStore, who: AuthResult & { ok: true }, needle: string): CommandPaletteRow[] {
  const tabs = visibleNavTabs(settings.get().sidebarTabs, {
    whiteboard: cfg.whiteboardEnabled,
    budget: budgetAvailable(cfg) && who.owner === true,
  });
  const out: CommandPaletteRow[] = [];
  for (const tab of tabs) {
    const score = needle ? scoreTextMatch(tab.label, needle) : 1;
    if (needle && score < 0) continue;
    out.push(row(`nav:${tab.href}`, "nav", tab.label, tab.href, needle ? score : 100 - tabs.indexOf(tab)));
  }
  for (const sub of AGENT_SUB_NAV) {
    const score = needle ? scoreTextMatch(sub.label, needle) : 0;
    if (needle && score < 0) continue;
    if (!needle) continue;
    out.push(row(`nav:${sub.href}`, "nav", `Agent · ${sub.label}`, sub.href, score - 5));
  }
  return out;
}

function noteRows(notes: NotesStore, needle: string): CommandPaletteRow[] {
  const listed = notes.listNotes(needle, true);
  const out: CommandPaletteRow[] = [];
  for (const note of listed) {
    const isMeeting = note.tags.includes(MEETING_TAG);
    const type: CommandPaletteRowType = isMeeting ? "meeting" : "note";
    const title = note.title || "(untitled)";
    const score = scoreTextMatch(title, needle) + (isNoteSensitive(note) ? 0 : 5);
    if (needle && score < 0) continue;
    const subtitle = isNoteSensitive(note) ? "Sensitive note" : note.tags.slice(0, 3).join(", ") || undefined;
    out.push(row(`${type}:${note.id}`, type, title, `/notes?note=${encodeURIComponent(note.id)}`, needle ? score : 0, subtitle));
  }
  return out;
}

function bookmarkRows(bookmarks: BookmarksStore, needle: string): CommandPaletteRow[] {
  const data = bookmarks.list();
  const out: CommandPaletteRow[] = [];
  for (const bm of data.bookmarks) {
    const hay = `${bm.title}\n${bm.description}\n${bm.url}`;
    const score = scoreTextMatch(hay, needle);
    if (needle && score < 0) continue;
    out.push(
      row(
        `bookmark:${bm.id}`,
        "bookmark",
        bm.title,
        bm.url,
        needle ? score : 0,
        bm.description || undefined,
      ),
    );
  }
  return out;
}

function boardRows(board: BoardStore, needle: string): CommandPaletteRow[] {
  const out: CommandPaletteRow[] = [];
  for (const card of board.list()) {
    const hay = `${card.title}\n${card.notes}`;
    const score = scoreTextMatch(hay, needle);
    if (needle && score < 0) continue;
    out.push(
      row(
        `board:${card.id}`,
        "board-card",
        card.title,
        "/agent?view=board",
        needle ? score : 0,
        card.column,
      ),
    );
  }
  return out;
}

function budgetRows(
  budget: BudgetStore | undefined,
  cfg: Config,
  who: AuthResult & { ok: true },
  needle: string,
  testIncludeBudgetWithoutOwner?: boolean,
): CommandPaletteRow[] {
  if (!budget || !needle) return [];
  const allowed =
    testIncludeBudgetWithoutOwner || (budgetAvailable(cfg) && isBudgetOwner(who));
  if (!allowed) return [];
  const out: CommandPaletteRow[] = [];
  for (const tx of budget.listTransactions(undefined, 500)) {
    const hay = `${tx.payee}\n${tx.memo ?? ""}`;
    const score = scoreTextMatch(hay, needle);
    if (score < 0) continue;
    out.push(
      row(
        `budget-tx:${tx.id}`,
        "budget-tx",
        tx.payee || "Transaction",
        "/budget?view=transactions",
        score,
        tx.date,
      ),
    );
  }
  return out;
}

function todoistRows(tasks: Awaited<ReturnType<TodoistOpenTaskCache["getOpenTasks"]>>, needle: string): CommandPaletteRow[] {
  const out: CommandPaletteRow[] = [];
  for (const task of tasks) {
    const hay = `${task.content}\n${task.description}`;
    const score = scoreTextMatch(hay, needle);
    if (needle && score < 0) continue;
    out.push(row(`task:${task.id}`, "task", task.content, task.url, needle ? score : 0, task.due?.string || undefined));
  }
  return out;
}

export async function searchCommandPalette(deps: CommandPaletteSearchDeps): Promise<CommandPaletteRow[]> {
  const needle = deps.query.trim();
  const limit = Math.min(MAX_LIMIT, Math.max(1, deps.limit ?? MAX_LIMIT));
  const rows: CommandPaletteRow[] = [];

  rows.push(...navRows(deps.cfg, deps.settings, deps.who, needle));

  if (needle) {
    rows.push(...noteRows(deps.notes, needle));
    rows.push(...bookmarkRows(deps.bookmarks, needle));
    rows.push(...boardRows(deps.board, needle));
    rows.push(
      ...budgetRows(deps.budget, deps.cfg, deps.who, needle, deps.testIncludeBudgetWithoutOwner),
    );
    const tasks = await deps.todoistCache.getOpenTasks();
    rows.push(...todoistRows(tasks, needle));
  }

  rows.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return rows.slice(0, limit);
}

/** True when budget transaction rows may appear in palette results. */
export function paletteBudgetRowsAllowed(
  cfg: Config,
  who: AuthResult & { ok: true },
  testIncludeBudgetWithoutOwner?: boolean,
): boolean {
  if (testIncludeBudgetWithoutOwner) return true;
  return budgetAvailable(cfg) && isBudgetOwner(who);
}
