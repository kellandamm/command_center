import type { IncomingMessage } from "node:http";
import { bearerToken, tokenEquals } from "../auth";
import type { Config } from "../config";
import { authenticateMcp, type McpAuthResult } from "../mcp/auth";

/** Machine import: MCP (Access JWT + app token) or AGENTS_USAGE_IMPORT_TOKEN bearer (pair with Cf-Access-Jwt-Assertion at the edge). */
export async function authenticateAgentsUsageImport(cfg: Config, req: IncomingMessage): Promise<McpAuthResult> {
  const mcp = await authenticateMcp(cfg, req);
  if (mcp.ok) return mcp;

  const importToken = cfg.agentsUsageImportToken;
  if (!importToken) {
    return { ok: false, status: 503, reason: "Agents usage import is not configured" };
  }

  const bearer = bearerToken(req);
  if (bearer && tokenEquals(bearer, importToken)) {
    return { ok: true, clientId: "agents-usage-import" };
  }

  return { ok: false, status: 401, reason: "Unauthorized" };
}
