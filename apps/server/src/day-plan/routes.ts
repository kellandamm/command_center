import type { IncomingMessage, ServerResponse } from "node:http";
import type { App } from "../http";
import { OWNER_ACTION_FORBIDDEN } from "../owner-auth";
import { ValidationError } from "../settings";
import { isDayPlanOwner } from "./owner";
import { gatherDayPlanContext } from "./gather";
import {
  applyDayPlanEdits,
  enrichStoredPlanForRead,
  generateAndPersistDeterministicPlan,
} from "./service";
import {
  DayPlanNotFoundError,
  dayFromBodyField,
  dayParamFromQuery,
  parseDayPlanPutBody,
  parseMustDoSlotBody,
} from "./validate";
import {
  DAY_PLAN_UI_HEADER,
  MustDoInFlightError,
  MustDoRemoteError,
  completeMustDoOnOwnerClick,
  reopenMustDoOnOwnerClick,
} from "./must-do";

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
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

function parseGenerateBody(body: unknown, tz: string, now: Date): { day: string; weekendOverride?: boolean } {
  const parsed = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const day = dayFromBodyField(parsed.day, tz, now);
  let weekendOverride: boolean | undefined;
  if ("weekendOverride" in parsed) {
    if (typeof parsed.weekendOverride !== "boolean") throw new ValidationError("weekendOverride must be a boolean.");
    weekendOverride = parsed.weekendOverride;
  }
  return { day, weekendOverride };
}

function denyUnlessOwnerUiClick(req: IncomingMessage, res: ServerResponse): boolean {
  // Defense-in-depth with x-ah; owner gate is CF-verified email in OWNER_EMAILS.
  if (req.headers[DAY_PLAN_UI_HEADER] !== "1") {
    json(res, 403, { error: OWNER_ACTION_FORBIDDEN });
    return false;
  }
  return true;
}

async function readMustDoBody(
  req: IncomingMessage,
  readBody: (req: IncomingMessage, limit?: number) => Promise<unknown>,
  tz: string,
  now: Date,
): Promise<{ day: string; slot: number }> {
  let body: unknown = {};
  try {
    body = await readBody(req, 8 * 1024);
  } catch (err) {
    if (err instanceof ValidationError && err.message === "request body too large") {
      throw new ValidationError("request body too large");
    }
    throw err;
  }
  return parseMustDoSlotBody(body, tz, now);
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
  const now = new Date();

  if (path === "/api/day-plan" && req.method === "GET") {
    if (!denyUnlessOwner(res, principal)) return true;
    const day = dayParamFromQuery(url.searchParams.get("day"), app.cfg.tz, now);
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
    const { day, weekendOverride } = parseGenerateBody(body, app.cfg.tz, now);
    const plan = await generateAndPersistDeterministicPlan({
      cfg: app.cfg,
      board: app.board,
      calendar: app.calendar,
      store: app.dayPlan,
      now,
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
    const edits = parseDayPlanPutBody(body, app.cfg.tz, now);
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
        now,
        day: edits.day,
        workStart: edits.workStart,
        workEnd: edits.workEnd,
        weekendOverride: edits.weekendOverride,
      });
      json(res, 200, { day: edits.day, plan });
    } catch (err) {
      if (err instanceof DayPlanNotFoundError) {
        json(res, 404, { error: "No plan for that day." });
        return true;
      }
      if (err instanceof ValidationError) throw err;
      const fail = err as Error & { code?: string };
      console.error("day-plan PUT failed:", fail.message);
      json(res, 500, { error: "internal error" });
    }
    return true;
  }

  if (path === "/api/day-plan/must-do/complete" && req.method === "POST") {
    if (!denyUnlessOwner(res, principal)) return true;
    if (!denyUnlessOwnerUiClick(req, res)) return true;
    try {
      const { day, slot } = await readMustDoBody(req, readBody, app.cfg.tz, now);
      const plan = await completeMustDoOnOwnerClick({
        cfg: app.cfg,
        board: app.board,
        hobieQueue: app.hobieQueue,
        wins: app.wins,
        calendar: app.calendar,
        store: app.dayPlan,
        now,
        day,
        slot,
      });
      json(res, 200, { day, plan });
    } catch (err) {
      if (err instanceof ValidationError && err.message === "request body too large") {
        json(res, 413, { error: "Request body too large." });
        return true;
      }
      if (err instanceof DayPlanNotFoundError) {
        json(res, 404, { error: "No plan for that day." });
        return true;
      }
      if (err instanceof ValidationError) throw err;
      if (err instanceof MustDoRemoteError) {
        json(res, err.status, { error: err.message });
        return true;
      }
      if (err instanceof MustDoInFlightError) {
        json(res, err.status, { error: err.message });
        return true;
      }
      console.error("day-plan must-do complete failed");
      json(res, 500, { error: "internal error" });
    }
    return true;
  }

  if (path === "/api/day-plan/must-do/reopen" && req.method === "POST") {
    if (!denyUnlessOwner(res, principal)) return true;
    if (!denyUnlessOwnerUiClick(req, res)) return true;
    try {
      const { day, slot } = await readMustDoBody(req, readBody, app.cfg.tz, now);
      const plan = await reopenMustDoOnOwnerClick({
        cfg: app.cfg,
        board: app.board,
        hobieQueue: app.hobieQueue,
        wins: app.wins,
        calendar: app.calendar,
        store: app.dayPlan,
        now,
        day,
        slot,
      });
      json(res, 200, { day, plan });
    } catch (err) {
      if (err instanceof ValidationError && err.message === "request body too large") {
        json(res, 413, { error: "Request body too large." });
        return true;
      }
      if (err instanceof DayPlanNotFoundError) {
        json(res, 404, { error: "No plan for that day." });
        return true;
      }
      if (err instanceof ValidationError) throw err;
      if (err instanceof MustDoRemoteError) {
        json(res, err.status, { error: err.message });
        return true;
      }
      if (err instanceof MustDoInFlightError) {
        json(res, err.status, { error: err.message });
        return true;
      }
      console.error("day-plan must-do reopen failed");
      json(res, 500, { error: "internal error" });
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
