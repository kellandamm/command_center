import sanitizeHtml from "sanitize-html";
import type { Config } from "../config";
import { todoistConfigured } from "../config";
import { createTask } from "../todoist/client";
import type { NotesStore } from "../notes/store";
import type { BoardStore } from "../board/store";
import { BOARD_COLUMNS, type BoardColumn } from "../board/types";
import type { HobieQueueStore } from "../stores/hobie-queue";
import type { PanelUpdatesStore } from "../stores/panel-updates";
import type { WinsStore } from "../wins/store";

const stripHtml = (s: string) => sanitizeHtml(s, { allowedTags: [], allowedAttributes: {} }).trim();

export interface IntegrationDeps {
  cfg: Config;
  notes: NotesStore;
  panelUpdates: PanelUpdatesStore;
  hobieQueue: HobieQueueStore;
  board: BoardStore;
  wins: WinsStore;
}

export async function actionNotesRead(deps: IntegrationDeps): Promise<{ content: string }> {
  return { content: await deps.notes.read() };
}

export async function actionNotesAppend(deps: IntegrationDeps, clientId: string, text: string): Promise<{ content: string }> {
  const line = `[mcp:${clientId}] ${stripHtml(text)}`;
  const content = await deps.notes.append(line);
  return { content };
}

export async function actionPanelPostUpdate(
  deps: IntegrationDeps,
  clientId: string,
  panel: string,
  markdown: string,
): Promise<{ id: string; createdAt: string }> {
  const row = await deps.panelUpdates.append({ clientId, panel, markdown: stripHtml(markdown) });
  return { id: row.id, createdAt: row.createdAt };
}

export async function actionTodoistAddTask(deps: IntegrationDeps, content: string): Promise<{ id: string; content: string }> {
  if (!todoistConfigured(deps.cfg)) throw new Error("Todoist is not configured on the server");
  const task = await createTask(deps.cfg.todoistApiToken!, stripHtml(content));
  return { id: task.id, content: task.content };
}

export async function actionBoardList(deps: IntegrationDeps): Promise<{ cards: ReturnType<BoardStore["list"]>; counts: ReturnType<BoardStore["columnCounts"]> }> {
  return { cards: deps.board.list(), counts: deps.board.columnCounts() };
}

export async function actionBoardMove(
  deps: IntegrationDeps,
  clientId: string,
  id: string,
  column: string,
  position?: number,
): Promise<{ card: import("../board/types").BoardCard }> {
  if (!(BOARD_COLUMNS as readonly string[]).includes(column)) throw new Error("invalid column");
  const card = await deps.board.move(id, column as BoardColumn, {
    position,
    hobieQueue: deps.hobieQueue,
    maxHobiePending: deps.cfg.mcpMaxHobiePending,
    wins: deps.wins,
  });
  if (!card) throw new Error("card not found");
  await deps.panelUpdates.append({
    clientId,
    panel: "board",
    markdown: `Moved **${card.title}** → ${column}`,
  });
  return { card };
}

export async function actionHobieQueueTask(
  deps: IntegrationDeps,
  clientId: string,
  title: string,
  body: string,
  urgent: boolean,
): Promise<{ id: string; urgent: boolean; createdAt: string }> {
  const task = await deps.hobieQueue.enqueue(
    { clientId, title: stripHtml(title), body: stripHtml(body), urgent },
    deps.cfg.mcpMaxHobiePending,
  );
  return { id: task.id, urgent: task.urgent, createdAt: task.createdAt };
}

export type WebhookAction =
  | "notes_read"
  | "notes_append"
  | "panel_post_update"
  | "todoist_add_task"
  | "hobie_queue_task";

export async function runWebhookAction(deps: IntegrationDeps, clientId: string, action: WebhookAction, body: Record<string, unknown>) {
  switch (action) {
    case "notes_read":
      return actionNotesRead(deps);
    case "notes_append":
      return actionNotesAppend(deps, clientId, String(body.text ?? ""));
    case "panel_post_update":
      return actionPanelPostUpdate(deps, clientId, String(body.panel ?? "activity"), String(body.markdown ?? body.text ?? ""));
    case "todoist_add_task":
      return actionTodoistAddTask(deps, String(body.content ?? body.text ?? ""));
    case "hobie_queue_task":
      return actionHobieQueueTask(deps, clientId, String(body.title ?? ""), String(body.body ?? body.text ?? ""), Boolean(body.urgent));
    default:
      throw new Error(`unknown action: ${action}`);
  }
}
