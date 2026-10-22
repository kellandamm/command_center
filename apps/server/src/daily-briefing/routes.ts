import type { IncomingMessage, ServerResponse } from "node:http";
import type { App } from "../http";
import { dayKey } from "../store";
import type { DailyBriefingService } from "./service";

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
): Promise<boolean> {
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
