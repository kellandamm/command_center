import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config";
import { llmConfigured } from "../config";
import { groupWinsByIsoWeek } from "./store";
import type { WinsStore } from "./store";
import { WinsRollupService } from "./rollup-service";

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

export async function handleWinsRoutes(
  wins: WinsStore,
  cfg: Config,
  rollup: WinsRollupService,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  body: unknown,
): Promise<boolean> {
  if (path === "/api/wins" && req.method === "GET") {
    const rows = wins.list();
    const grouped = [...groupWinsByIsoWeek(rows).entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([isoWeek, weekWins]) => ({ isoWeek, wins: weekWins }));
    const summaries = llmConfigured(cfg) ? await rollup.enrichWeeks(rows) : new Map<string, string | null>();
    const weeks = grouped.map((g) => ({
      ...g,
      summary: summaries.get(g.isoWeek) ?? wins.getWeekSummary(g.isoWeek)?.summary ?? null,
    }));
    json(res, 200, { wins: rows, weeks, llmEnabled: llmConfigured(cfg) });
    return true;
  }

  if (path === "/api/wins" && req.method === "POST") {
    const parsed = (body ?? {}) as { title?: string; ref?: string };
    const title = String(parsed.title ?? "").trim();
    const ref = String(parsed.ref ?? "").trim() || title.slice(0, 80) || `manual-${Date.now()}`;
    const win = wins.add({ source: "manual", ref, title });
    if (!win) {
      json(res, 400, { error: "title is required" });
      return true;
    }
    json(res, 201, { win });
    return true;
  }

  return false;
}
