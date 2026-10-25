import type { IncomingMessage } from "node:http";
import { bearerToken, tokenEquals } from "../auth";
import type { Config } from "../config";
import { authenticateMcp, type McpAuthResult } from "../mcp/auth";

/** Machine import: MCP (Access JWT + app token) or MEETINGS_IMPORT_TOKEN bearer. */
export async function authenticateMeetingImport(cfg: Config, req: IncomingMessage): Promise<McpAuthResult> {
  const mcp = await authenticateMcp(cfg, req);
  if (mcp.ok) return mcp;

  const importToken = cfg.meetingsImportToken;
  if (importToken) {
    const bearer = bearerToken(req);
    if (bearer && tokenEquals(bearer, importToken)) {
      return { ok: true, clientId: "meetings-import" };
    }
  }

  return { ok: false, status: 401, reason: "Unauthorized" };
}
