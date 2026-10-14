import type { IncomingMessage, ServerResponse } from "node:http";
import type { AiSecurityService } from "./service";

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function handleAiSecurityRoutes(
  aiSecurity: AiSecurityService,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  readBody: (req: IncomingMessage) => Promise<unknown>,
): Promise<boolean> {
  if (path === "/api/ai-security/roundups" && req.method === "GET") {
    const weeks = await aiSecurity.listWeeks();
    const latest = await aiSecurity.latest();
    json(res, 200, { weeks, latest: latest ?? null });
    return true;
  }

  if (path === "/api/ai-security/roundups/latest" && req.method === "GET") {
    const latest = await aiSecurity.latest();
    json(res, 200, { roundup: latest ?? null });
    return true;
  }

  if (path === "/api/ai-security/roundups" && req.method === "POST") {
    const rec = await aiSecurity.publish(await readBody(req));
    json(res, 201, { roundup: rec });
    return true;
  }

  const weekMatch = /^\/api\/ai-security\/roundups\/(\d{4}-\d{2}-\d{2})$/.exec(path);
  if (weekMatch && req.method === "GET") {
    const weekOf = weekMatch[1]!;
    if (!DAY_RE.test(weekOf)) {
      json(res, 400, { error: "invalid week" });
      return true;
    }
    const roundup = await aiSecurity.get(weekOf);
    json(res, 200, { weekOf, roundup: roundup ?? null });
    return true;
  }

  return false;
}
