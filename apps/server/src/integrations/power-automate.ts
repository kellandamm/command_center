import type { IncomingMessage, ServerResponse } from "node:http";
import type { IntegrationDeps } from "../mcp/actions";
import { runWebhookAction, type WebhookAction } from "../mcp/actions";
import { authenticateWebhook } from "../mcp/auth";
import { McpRateLimiter } from "../mcp/rate-limit";

const limiter = new McpRateLimiter();

const ACTIONS = new Set<WebhookAction>([
  "notes_read",
  "notes_append",
  "panel_post_update",
  "todoist_add_task",
  "hobie_queue_task",
]);

export async function handlePowerAutomateWebhook(
  deps: IntegrationDeps,
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
): Promise<void> {
  const auth = await authenticateWebhook(deps.cfg, req);
  if (!auth.ok) {
    res.writeHead(auth.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: auth.reason }));
    return;
  }
  if (!limiter.allow(auth.clientId)) {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "rate limit exceeded" }));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  const parsed = (body ?? {}) as Record<string, unknown>;
  const action = String(parsed.action ?? "") as WebhookAction;
  if (!ACTIONS.has(action)) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid action" }));
    return;
  }

  try {
    const result = await runWebhookAction(deps, auth.clientId, action, parsed);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, action, result }));
  } catch (err) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "action failed" }));
  }
}
