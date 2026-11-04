import type { IncomingMessage, ServerResponse } from "node:http";
import type { App } from "../http";
import { dayKey } from "../store";
import { OWNER_ACTION_FORBIDDEN } from "../owner-auth";
import { ValidationError } from "../settings";
import { isDayPlanOwner } from "./owner";
import { gatherDayPlanContext } from "./gather";
import {
  applyDayPlanEdits,
  enrichStoredPlanForRead,
  generateAndPersistDeterministicPlan,
  parseDayPlanPutBody,
} from "./service";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

function parseDayParam(url: URL, tz: string): string {
  const param = url.searchParams.get("day");
  if (param && DAY_RE.test(param)) return param;
  return dayKey(new Date(), tz);
}

function denyUnlessOwner(
  res: ServerResponse,
  principal: { owner: boolean } | undefined,
): principal is { owner: boolean; who: string; email?: string; serviceToken?: boolean } {
  if (!principal || !isDayPlanOwner(principal)) {
    json(res, 403, { error: OWNER_ACTION_FORBIDDEN });
    return false;
  }
  return true;
}

export async function handleDayPlanRoutes(
  app: App,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  principal: { owner: boolean; who: string; email?: string; serviceToken?: boolean } | undefined,
  readBody: (req: IncomingMessage, limit?: number) => Promise<unknown>,
): Promise<boolean> {
  if (!path.startsWith("/api/day-plan")) return false;

  const url = new URL(req.url ?? "/", "http://local");

  if (path === "/api/day-plan" && req.method === "GET") {
    if (!denyUnlessOwner(res, principal)) return true;
    const day = parseDayParam(url, app.cfg.tz);
    const now = new Date();
    let plan = app.dayPlan.load(day);
    if (!plan) {
      plan = await generateAndPersistDeterministicPlan({
        cfg: app.cfg,
        board: app.board,
        calendar: app.calendar,
        store: app.dayPlan,
        now,
        day,
      });
    } else {
      const context = await gatherDayPlanContext({
        cfg: app.cfg,
        board: app.board,
        calendar: app.calendar,
        now,
        day,
      });
      plan = enrichStoredPlanForRead(plan, context, app.dayPlan, day);
    }
    json(res, 200, { day, plan });
    return true;
  }

  if (path === "/api/day-plan/generate" && req.method === "POST") {
    if (!denyUnlessOwner(res, principal)) return true;
    let body: unknown = {};
    try {
      body = await readBody(req, 32 * 1024);
    } catch (err) {
      if (err instanceof ValidationError && err.message === "request body too large") {
        json(res, 413, { error: "Request body too large." });
        return true;
      }
      throw err;
    }
    const parsed = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const day =
      typeof parsed.day === "string" && DAY_RE.test(parsed.day) ? parsed.day : dayKey(new Date(), app.cfg.tz);
    const weekendOverride = parsed.weekendOverride === true;
    const plan = await generateAndPersistDeterministicPlan({
      cfg: app.cfg,
      board: app.board,
      calendar: app.calendar,
      store: app.dayPlan,
      now: new Date(),
      day,
      weekendOverride,
    });
    json(res, 200, { day, plan });
    return true;
  }

  if (path === "/api/day-plan" && req.method === "PUT") {
    if (!denyUnlessOwner(res, principal)) return true;
    let body: unknown;
    try {
      body = await readBody(req, 64 * 1024);
    } catch (err) {
      if (err instanceof ValidationError && err.message === "request body too large") {
        json(res, 413, { error: "Request body too large." });
        return true;
      }
      throw err;
    }
    const edits = parseDayPlanPutBody(body);
    if (!edits) {
      json(res, 400, { error: "Invalid day plan payload." });
      return true;
    }
    if (!app.dayPlan.load(edits.day)) {
      json(res, 404, { error: "No plan for that day." });
      return true;
    }
    try {
      const plan = await applyDayPlanEdits({
        cfg: app.cfg,
        board: app.board,
        calendar: app.calendar,
        store: app.dayPlan,
        now: new Date(),
        day: edits.day,
        workStart: edits.workStart,
        workEnd: edits.workEnd,
        weekendOverride: edits.weekendOverride,
      });
      json(res, 200, { day: edits.day, plan });
    } catch {
      json(res, 404, { error: "No plan for that day." });
    }
    return true;
  }

  if (path.startsWith("/api/day-plan")) {
    if (!denyUnlessOwner(res, principal)) return true;
    json(res, 404, { error: "Not found" });
    return true;
  }

  return false;
}
