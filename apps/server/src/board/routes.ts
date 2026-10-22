import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config";
import type { HobieQueueStore } from "../stores/hobie-queue";
import type { WinsStore } from "../wins/store";
import { BOARD_COLUMNS, type BoardColumn } from "./types";
import { BoardConflictError, type BoardStore, type CardPlanningInput } from "./store";

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

function isColumn(c: string): c is BoardColumn {
  return (BOARD_COLUMNS as readonly string[]).includes(c);
}

export async function handleBoardRoutes(
  board: BoardStore,
  hobieQueue: HobieQueueStore,
  wins: WinsStore,
  cfg: Config,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  body: unknown,
): Promise<boolean> {
  if (path === "/api/board/cards" && req.method === "GET") {
    json(res, 200, { cards: board.list(), columns: BOARD_COLUMNS, counts: board.columnCounts() });
    return true;
  }

  if (path === "/api/board/cards" && req.method === "POST") {
    const parsed = (body ?? {}) as { title?: string; notes?: string; column?: string } & CardPlanningInput;
    try {
      const column = parsed.column && isColumn(parsed.column) ? parsed.column : undefined;
      const card = board.create({ ...parsed, title: String(parsed.title ?? ""), column });
      json(res, 201, { card });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (path === "/api/board/cards" && req.method === "PATCH") {
    const parsed = (body ?? {}) as { id?: string; column?: string; position?: number; title?: string; notes?: string; expectedVersion?: unknown } & CardPlanningInput;
    if (!parsed.id) {
      json(res, 400, { error: "id is required" });
      return true;
    }
    let card = board.get(parsed.id);
    if (!card) {
      json(res, 404, { error: "card not found" });
      return true;
    }
    try {
      const planning = ["estimatedMinutes", "dueDate", "priority"].some((key) => key in parsed);
      if (planning || parsed.expectedVersion !== undefined) board.checkVersion(parsed.id, parsed.expectedVersion);
      if (parsed.column !== undefined && !isColumn(parsed.column)) throw new Error("invalid column");
      if (parsed.position !== undefined && (!Number.isSafeInteger(parsed.position) || parsed.position < 0)) throw new Error("invalid position");
      if (parsed.title !== undefined || parsed.notes !== undefined || planning) {
        card = board.updateMeta(parsed.id, parsed) ?? card;
      }
      const targetCol = parsed.column && isColumn(parsed.column) ? parsed.column : card.column;
      if (targetCol !== card.column || parsed.position !== undefined) {
        card =
          (await board.move(parsed.id, targetCol, {
            position: parsed.position,
            hobieQueue,
            maxHobiePending: cfg.mcpMaxHobiePending,
            wins,
          })) ?? card;
      }
      json(res, 200, { card });
    } catch (err) {
      json(res, err instanceof BoardConflictError ? 409 : 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  return false;
}
