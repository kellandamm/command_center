import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config";
import { llmConfigured } from "../config";
import type { CalendarWorkspace } from "../calendar/workspace";
import { OWNER_ACTION_FORBIDDEN } from "../owner-auth";
import { ValidationError } from "../settings";
import { commitQuickAddItems } from "./commit";
import { parseQuickAddPayload } from "./normalize";
import { parseQuickAddText } from "./parse";

export async function handleQuickAddRoutes(
  cfg: Config,
  calendar: CalendarWorkspace | undefined,
  canManage: boolean,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  readBody: (req: IncomingMessage, limit?: number) => Promise<unknown>,
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
    if (!llmConfigured(cfg)) return json(503, { error: "LLM is not configured on the server" });
    const text = typeof (body as Record<string, unknown>)?.text === "string" ? String((body as Record<string, unknown>).text) : "";
    try {
      const items = await parseQuickAddText(cfg, text);
      return json(200, { items });
    } catch (err) {
      if (err instanceof ValidationError) return json(400, { error: err.message });
      return json(502, { error: err instanceof Error ? err.message : "Quick add parse failed" });
    }
  }
  try {
    const payload = body as Record<string, unknown>;
    const rawItems = Array.isArray(payload.items) ? payload.items : null;
    if (!rawItems) throw new ValidationError("Expected items array");
    parseQuickAddPayload({ items: rawItems });
    const calendarId = typeof payload.calendarId === "string" ? payload.calendarId : undefined;
    const results = await commitQuickAddItems(cfg, calendar, rawItems, { calendarId });
    return json(200, { results });
  } catch (err) {
    if (err instanceof ValidationError) {
      const status = err.message.includes("not configured") ? 503 : 400;
      return json(status, { error: err.message });
    }
    return json(500, { error: err instanceof Error ? err.message : "Quick add commit failed" });
  }
}
