import type { IncomingMessage, ServerResponse } from "node:http";
import type { App } from "../http";
import { llmConfigured } from "../config";
import { dayKey } from "../store";
import { canManageSharedServerState, OWNER_ACTION_FORBIDDEN } from "../owner-auth";
import {
  buildShutdownReview,
  generateShutdownReflection,
  parseClientShutdownReview,
} from "../briefing/shutdown-service";
import { ValidationError } from "../settings";
import type { DailyBriefingService } from "./service";

const REFLECTION_BODY_LIMIT = 64 * 1024;

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function handleDailyBriefingRoutes(
  app: App,
  daily: DailyBriefingService,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  principal?: { owner: boolean; who: string; email?: string; serviceToken?: boolean },
  readBody?: (req: IncomingMessage, limit?: number) => Promise<unknown>,
): Promise<boolean> {
  if (path === "/api/briefing/shutdown" && req.method === "GET" && principal) {
    if (!canManageSharedServerState(app.cfg, principal)) {
      json(res, 403, { error: OWNER_ACTION_FORBIDDEN });
      return true;
    }
    const review = await buildShutdownReview({
      cfg: app.cfg,
      board: app.board,
      calendar: app.calendar,
      now: new Date(),
    });
    json(res, 200, { review });
    return true;
  }

  if (path === "/api/briefing/shutdown/reflection" && req.method === "POST" && principal && readBody) {
    if (!principal.owner) {
      json(res, 403, { error: OWNER_ACTION_FORBIDDEN });
      return true;
    }
    let body: unknown;
    try {
      body = await readBody(req, REFLECTION_BODY_LIMIT);
    } catch (err) {
      if (err instanceof ValidationError && err.message === "request body too large") {
        json(res, 413, { error: "Request body too large." });
        return true;
      }
      throw err;
    }
    const source = parseClientShutdownReview(body, app.cfg.tz);
    if (!source) {
      json(res, 400, { error: "Invalid shutdown review payload." });
      return true;
    }
    const reflection = await generateShutdownReflection(source, app.cfg);
    json(res, 200, { reflection, llmEnabled: llmConfigured(app.cfg) });
    return true;
  }

  if (path === "/api/daily-briefing/days" && req.method === "GET") {
    const days = await daily.listDays();
    json(res, 200, { days });
    return true;
  }

  if (path === "/api/daily-briefing/refresh" && req.method === "POST") {
    const now = new Date();
    const day = dayKey(now, app.cfg.tz);
    void daily.generate({
      cfg: app.cfg,
      topics: app.settings.get().briefingTopics,
      calendar: app.calendar,
      trigger: "manual",
      now,
    }).catch((err: unknown) => console.error("Manual briefing refresh failed:", err));
    json(res, 202, { day, status: "generating" });
    return true;
  }

  if (path === "/api/daily-briefing/refresh" && req.method === "GET") {
    const url = new URL(req.url ?? "/", "http://local");
    const param = url.searchParams.get("day");
    const day = param && DAY_RE.test(param) ? param : dayKey(new Date(), app.cfg.tz);
    json(res, 200, { day, ...daily.generationState(day) });
    return true;
  }

  if (path === "/api/daily-briefing" && req.method === "GET") {
    const url = new URL(req.url ?? "/", "http://local");
    const dayParam = url.searchParams.get("day");
    const day = dayParam && DAY_RE.test(dayParam) ? dayParam : dayKey(new Date(), app.cfg.tz);
    const briefing = await daily.get(day);
    json(res, 200, { day, briefing: briefing ?? null });
    return true;
  }

  return false;
}
