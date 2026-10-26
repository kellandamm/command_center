import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config";
import { llmConfigured, todoistConfigured } from "../config";
import type { CalendarWorkspace } from "../calendar/workspace";
import type { BoardStore } from "../board/store";
import { OWNER_ACTION_FORBIDDEN } from "../owner-auth";
import { ValidationError } from "../settings";
import { commitQuickAddItems } from "./commit";
import {
  QUICK_ADD_COMMIT_OWNER_REQUIRED,
  QUICK_ADD_LLM_ERROR,
  QUICK_ADD_LLM_NOT_CONFIGURED,
  QUICK_ADD_TODOIST_NOT_CONFIGURED,
} from "./errors";
import { parseQuickAddPayload } from "./normalize";
import { parseQuickAddText } from "./parse";

export async function handleQuickAddRoutes(
  cfg: Config,
  calendar: CalendarWorkspace | undefined,
  canManage: boolean,
  owner: boolean,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  readBody: (req: IncomingMessage, limit?: number) => Promise<unknown>,
  board?: BoardStore,
): Promise<boolean> {
  if (path !== "/api/quick-add/parse" && path !== "/api/quick-add/commit") return false;
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
    return true;
  };
  if (!canManage) return json(403, { error: OWNER_ACTION_FORBIDDEN });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const body = await readBody(req, 64_000);
  if (path === "/api/quick-add/parse") {
    if (!llmConfigured(cfg)) return json(503, { error: QUICK_ADD_LLM_NOT_CONFIGURED });
    const text = typeof (body as Record<string, unknown>)?.text === "string" ? String((body as Record<string, unknown>).text) : "";
    try {
      const items = await parseQuickAddText(cfg, text);
      return json(200, { items });
    } catch (err) {
      if (err instanceof ValidationError) return json(400, { error: err.message });
      return json(502, { error: QUICK_ADD_LLM_ERROR });
    }
  }
  if (!owner) return json(403, { error: QUICK_ADD_COMMIT_OWNER_REQUIRED });
  try {
    const payload = body as Record<string, unknown>;
    const rawItems = Array.isArray(payload.items) ? payload.items : null;
    if (!rawItems) throw new ValidationError("Expected items array");
    const parsedItems = parseQuickAddPayload({ items: rawItems });
    if (parsedItems.some((item) => item.kind === "task" && item.source !== "board") && !todoistConfigured(cfg)) {
      return json(503, { error: QUICK_ADD_TODOIST_NOT_CONFIGURED });
    }
    const calendarId = typeof payload.calendarId === "string" ? payload.calendarId : undefined;
    const { results, failures } = await commitQuickAddItems(cfg, calendar, rawItems, { calendarId, board });
    return json(200, { results, failures });
  } catch (err) {
    if (err instanceof ValidationError) {
      const msg = err.message;
      if (msg === QUICK_ADD_TODOIST_NOT_CONFIGURED || msg === QUICK_ADD_LLM_NOT_CONFIGURED) return json(503, { error: msg });
      return json(400, { error: msg });
    }
    return json(500, { error: "Quick add commit failed" });
  }
}
