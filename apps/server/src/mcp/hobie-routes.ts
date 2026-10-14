import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config";
import type { HobieQueueStore } from "../stores/hobie-queue";
import { authenticateHobiePoll } from "./auth";

export async function handleHobieAgentRoutes(
  cfg: Config,
  hobieQueue: HobieQueueStore,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  body: unknown,
): Promise<boolean> {
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  };

  const auth = authenticateHobiePoll(cfg, req, cfg.adminToken ?? undefined);
  if (!auth.ok) {
    json(auth.status, { error: auth.reason });
    return true;
  }

  if (path === "/api/hobie/tasks" && req.method === "GET") {
    const q = new URL(req.url ?? "/", "http://x").searchParams;
    const status = (q.get("status") as "pending" | "claimed" | "done" | null) ?? "pending";
    json(200, { tasks: hobieQueue.list({ status }) });
    return true;
  }

  if (path === "/api/hobie/claim" && req.method === "POST") {
    const parsed = (body ?? {}) as { id?: string };
    if (!parsed.id) {
      json(400, { error: "id is required" });
      return true;
    }
    const task = await hobieQueue.claim(parsed.id);
    if (!task) {
      json(404, { error: "task not found or not pending" });
      return true;
    }
    json(200, { task });
    return true;
  }

  json(404, { error: "not found" });
  return true;
}
