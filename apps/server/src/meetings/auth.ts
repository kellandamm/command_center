import type { IncomingMessage } from "node:http";
import { bearerToken } from "../auth";
import type { Config } from "../config";
import type { CaptureAccess } from "../read-later/capture-access";
import { authenticateHobiePoll, authenticateMcp, type McpAuthResult } from "../mcp/auth";

/** Machine import: MCP (Access + app token), admin/MCP bearer, or capture token. */
export async function authenticateMeetingImport(
  cfg: Config,
  req: IncomingMessage,
  captureAccess: CaptureAccess,
): Promise<McpAuthResult> {
  const mcp = await authenticateMcp(cfg, req);
  if (mcp.ok) return mcp;

  const hobieStyle = authenticateHobiePoll(cfg, req, cfg.adminToken ?? undefined);
  if (hobieStyle.ok) return hobieStyle;

  const bearer = bearerToken(req);
  if (bearer && (await captureAccess.accepts(bearer))) {
    return { ok: true, clientId: "capture" };
  }

  return { ok: false, status: 401, reason: "Unauthorized" };
}
