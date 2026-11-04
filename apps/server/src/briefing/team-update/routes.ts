import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { Config } from "../../config";
import { dayKey } from "../../store";
import { ValidationError } from "../../settings";
import { OWNER_ACTION_FORBIDDEN } from "../../owner-auth";
import { TEAM_UPDATE_IMPORT_MAX_BYTES } from "./constants";
import { authenticateTeamUpdateImport } from "./auth";
import { rejectForbiddenPayloadKeys } from "./privacy";
import { teamUpdateImportBodySchema } from "./schema";
import type { TeamUpdateStore } from "./store";

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  let body = "";
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    body += chunk.toString();
    if (Buffer.byteLength(body, "utf8") > maxBytes) throw new ValidationError("request body too large");
  }
  try {
    return JSON.parse(body || "{}") as unknown;
  } catch (err) {
    if (err instanceof SyntaxError) throw new ValidationError("invalid JSON");
    throw new ValidationError("invalid JSON");
  }
}

export async function handleTeamUpdateImportRoute(
  cfg: Config,
  store: TeamUpdateStore,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    json(res, 405, { error: "method not allowed" });
    return;
  }
  const auth = await authenticateTeamUpdateImport(cfg, req);
  if (!auth.ok) {
    json(res, auth.status, { error: auth.reason });
    return;
  }
  try {
    const raw = await readJson(req, TEAM_UPDATE_IMPORT_MAX_BYTES);
    rejectForbiddenPayloadKeys(raw);
    const body = teamUpdateImportBodySchema.parse(raw);
    const result = await store.importPayload(body);
    json(res, 200, { ok: true, replaced: result.replaced, date: result.record.date, importedAt: result.record.importedAt });
  } catch (err) {
    if (err instanceof ValidationError) {
      const status = err.message === "request body too large" ? 413 : 400;
      json(res, status, { error: err.message });
      return;
    }
    if (err instanceof z.ZodError) {
      json(res, 400, { error: "validation failed" });
      return;
    }
    json(res, 500, { error: "import failed" });
  }
}

export function handleTeamUpdateGetRoute(
  cfg: Config,
  store: TeamUpdateStore,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  owner: boolean,
  url: URL,
): boolean {
  if (path !== "/api/team-update") return false;
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (!owner) {
    json(res, 403, { error: OWNER_ACTION_FORBIDDEN });
    return true;
  }
  const dayParam = url.searchParams.get("day");
  const day = dayParam && DAY_RE.test(dayParam) ? dayParam : dayKey(new Date(), cfg.tz);
  const record = store.getDay(day);
  if (req.method === "HEAD") {
    res.writeHead(record ? 200 : 404, { "cache-control": "no-store" });
    res.end();
    return true;
  }
  json(res, 200, {
    day,
    days: store.listDayKeys(),
    update: record ?? null,
  });
  return true;
}
