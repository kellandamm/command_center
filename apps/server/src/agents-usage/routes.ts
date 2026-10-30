import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { Config } from "../config";
import { ValidationError } from "../settings";
import { USAGE_IMPORT_MAX_BYTES } from "./constants";
import { authenticateAgentsUsageImport } from "./auth";
import { usageImportBodySchema } from "./schema";
import type { AgentsUsageStore } from "./store";
import { buildUsageDashboard } from "./view";

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  let body = "";
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    body += chunk.toString();
    if (Buffer.byteLength(body, "utf8") > maxBytes) throw new ValidationError("payload too large");
  }
  try {
    return JSON.parse(body || "{}") as unknown;
  } catch (err) {
    if (err instanceof SyntaxError) throw new ValidationError("invalid JSON");
    throw new ValidationError("invalid JSON");
  }
}

export async function handleAgentsUsageImportRoute(
  cfg: Config,
  store: AgentsUsageStore,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    json(res, 405, { error: "method not allowed" });
    return;
  }
  const auth = await authenticateAgentsUsageImport(cfg, req);
  if (!auth.ok) {
    json(res, auth.status, { error: auth.reason });
    return;
  }
  try {
    const raw = await readJson(req, USAGE_IMPORT_MAX_BYTES);
    const body = usageImportBodySchema.parse(raw);
    const result = await store.importPayload(body);
    json(res, 200, { ok: true, duplicate: result.duplicate, asOf: result.snapshot.asOf });
  } catch (err) {
    if (err instanceof ValidationError) {
      json(res, 400, { error: err.message });
      return;
    }
    const zodMsg = err instanceof z.ZodError ? "validation failed" : null;
    if (zodMsg) {
      json(res, 400, { error: zodMsg });
      return;
    }
    json(res, 500, { error: "import failed" });
  }
}

export function handleAgentsUsageGetRoutes(
  store: AgentsUsageStore,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (path === "/api/agents/usage") {
    json(res, 200, buildUsageDashboard(store));
    return true;
  }
  if (path === "/api/agents/usage/history") {
    json(res, 200, { snapshots: store.listSnapshots() });
    return true;
  }
  if (path === "/api/agents/usage/checkins") {
    json(res, 200, { checkins: store.listCheckins() });
    return true;
  }
  return false;
}
