import type { IncomingMessage, ServerResponse } from "node:http";
import type { App } from "../http";
import { canManageSharedServerState, OWNER_ACTION_FORBIDDEN } from "../owner-auth";
import { buildShutdownReview, generateShutdownReflection } from "./shutdown-service";

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

function shutdownPrincipal(app: App, owner: boolean, who: string, email?: string, serviceToken?: boolean) {
  return canManageSharedServerState(app.cfg, { owner, who, email, serviceToken });
}

export async function handleBriefingRoutes(
  app: App,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  principal: { owner: boolean; who: string; email?: string; serviceToken?: boolean },
): Promise<boolean> {
  if (path === "/api/briefing/shutdown" && req.method === "GET") {
    if (!shutdownPrincipal(app, principal.owner, principal.who, principal.email, principal.serviceToken)) {
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

  if (path === "/api/briefing/shutdown/reflection" && req.method === "POST") {
    if (!shutdownPrincipal(app, principal.owner, principal.who, principal.email, principal.serviceToken)) {
      json(res, 403, { error: OWNER_ACTION_FORBIDDEN });
      return true;
    }
    const review = await buildShutdownReview({
      cfg: app.cfg,
      board: app.board,
      calendar: app.calendar,
      now: new Date(),
    });
    const reflection = await generateShutdownReflection(review, app.cfg);
    json(res, 200, { reflection, llmEnabled: review.llmEnabled });
    return true;
  }

  return false;
}
