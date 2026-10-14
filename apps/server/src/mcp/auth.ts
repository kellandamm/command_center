import type { IncomingMessage } from "node:http";
import { tokenEquals } from "../auth";
import type { Config } from "../config";
import { mcpClientIdForCfAccessClientId, mcpConfigured, resolveMcpClientFromBearer } from "../config";

export type McpAuthResult = { ok: true; clientId: string } | { ok: false; status: 401 | 403; reason: string };

export function authenticateMcp(cfg: Config, req: IncomingMessage): McpAuthResult {
  if (!mcpConfigured(cfg)) {
    return { ok: false, status: 403, reason: "MCP is not configured (set MCP_APP_TOKENS)" };
  }

  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return { ok: false, status: 401, reason: "Bearer app token required" };

  const fromToken = resolveMcpClientFromBearer(cfg, bearer);
  if (!fromToken) return { ok: false, status: 401, reason: "Invalid MCP app token" };

  if (cfg.cfTeamDomain && cfg.cfAud) {
    const cfId = req.headers["cf-access-client-id"];
    const presented = (Array.isArray(cfId) ? cfId[0] : cfId)?.trim();
    if (!presented) return { ok: false, status: 403, reason: "CF-Access-Client-Id required" };
    const mapped = mcpClientIdForCfAccessClientId(cfg, presented);
    if (!mapped) return { ok: false, status: 403, reason: "Unknown Cloudflare Access service token" };
    if (mapped !== fromToken) return { ok: false, status: 403, reason: "App token does not match Access client" };
    return { ok: true, clientId: mapped };
  }

  return { ok: true, clientId: fromToken };
}

export function authenticateWebhook(cfg: Config, req: IncomingMessage): McpAuthResult {
  if (!cfg.webhookSecret) return { ok: false, status: 403, reason: "Webhook is not configured" };
  const header = req.headers["x-webhook-secret"];
  const presented = (Array.isArray(header) ? header[0] : header) ?? req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!presented || !tokenEquals(presented, cfg.webhookSecret)) {
    return { ok: false, status: 401, reason: "Invalid webhook secret" };
  }
  const client = req.headers["x-mcp-client-id"];
  const clientId = (Array.isArray(client) ? client[0] : client)?.trim() || "power-automate";
  return { ok: true, clientId };
}

/** Hobie poll: dedicated token, MCP app token, or admin token. */
export function authenticateHobiePoll(cfg: Config, req: IncomingMessage, adminToken?: string): McpAuthResult {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return { ok: false, status: 401, reason: "Bearer token required" };
  if (cfg.hobiePollToken && tokenEquals(bearer, cfg.hobiePollToken)) return { ok: true, clientId: "hobie" };
  const mcpClient = resolveMcpClientFromBearer(cfg, bearer);
  if (mcpClient) return { ok: true, clientId: mcpClient };
  if (adminToken && tokenEquals(bearer, adminToken)) return { ok: true, clientId: "admin" };
  return { ok: false, status: 401, reason: "Invalid token" };
}
