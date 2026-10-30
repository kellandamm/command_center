import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthResult } from "../auth";
import type { BookmarksStore } from "../bookmarks/store";
import type { BoardStore } from "../board/store";
import type { BudgetStore } from "../budget/store";
import type { Config } from "../config";
import type { NotesStore } from "../notes/store";
import type { SettingsStore } from "../settings";
import { MAX_QUERY_LENGTH, searchCommandPalette } from "./search";
import { TodoistOpenTaskCache } from "./todoist-cache";

const SECURITY = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
} as const;

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...SECURITY });
  res.end(JSON.stringify(data));
}

export interface CommandPaletteRouteDeps {
  cfg: Config;
  settings: SettingsStore;
  notes: NotesStore;
  bookmarks: BookmarksStore;
  board: BoardStore;
  budget?: BudgetStore;
  todoistCache: TodoistOpenTaskCache;
}

export async function handleCommandPaletteRoutes(
  deps: CommandPaletteRouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  url: URL,
  who: AuthResult & { ok: true },
): Promise<boolean> {
  if (path !== "/api/command-palette/search" || (req.method !== "GET" && req.method !== "HEAD")) return false;
  const qRaw = url.searchParams.get("q") ?? "";
  const trimmed = qRaw.trim();
  const q = trimmed.length > MAX_QUERY_LENGTH ? trimmed.slice(0, MAX_QUERY_LENGTH) : trimmed;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw != null ? Number(limitRaw) : undefined;
  if (req.method === "HEAD") {
    json(res, 200, { results: [] });
    return true;
  }
  const results = await searchCommandPalette({
    query: q,
    limit: Number.isFinite(limit) ? limit : undefined,
    cfg: deps.cfg,
    settings: deps.settings,
    notes: deps.notes,
    bookmarks: deps.bookmarks,
    board: deps.board,
    budget: deps.budget,
    who,
    todoistCache: deps.todoistCache,
  });
  json(res, 200, { results });
  return true;
}
