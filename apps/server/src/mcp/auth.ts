import type { IncomingMessage } from "node:http";
import { tokenEquals } from "../auth";
import type { Config } from "../config";
import { mcpClientIdForCfAccessClientId, mcpConfigured, resolveMcpClientFromBearer } from "../config";

export type McpAuthResult = { ok: true; clientId: string } | { ok: false; status: 401 | 403; reason: string };

/** Integrations always require a non-empty MCP_CF_CLIENT_MAP and a known inbound service token. */
export function requireCfServiceClient(cfg: Config, req: IncomingMessage): McpAuthResult {
  if (Object.keys(cfg.mcpCfClientMap).length === 0) {
    return { ok: false, status: 403, reason: "MCP_CF_CLIENT_MAP is required for integrations" };
  }
  const cfId = req.headers["cf-access-client-id"];
  const presented = (Array.isArray(cfId) ? cfId[0] : cfId)?.trim();
  if (!presented) return { ok: false, status: 403, reason: "CF-Access-Client-Id required" };
  const mapped = mcpClientIdForCfAccessClientId(cfg, presented);
  if (!mapped) return { ok: false, status: 403, reason: "Unknown Cloudflare Access service token" };
  return { ok: true, clientId: mapped };
}

export function authenticateMcp(cfg: Config, req: IncomingMessage): McpAuthResult {
  const cf = requireCfServiceClient(cfg, req);
  if (!cf.ok) return cf;

  if (!mcpConfigured(cfg)) {
    return { ok: false, status: 403, reason: "MCP is not configured (set MCP_APP_TOKENS)" };
  }

  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return { ok: false, status: 401, reason: "Bearer app token required" };

  const fromToken = resolveMcpClientFromBearer(cfg, bearer);
  if (!fromToken) return { ok: false, status: 401, reason: "Invalid MCP app token" };
  if (fromToken !== cf.clientId) {
    return { ok: false, status: 403, reason: "App token does not match Access client" };
  }
  return { ok: true, clientId: cf.clientId };
}

export function authenticateWebhook(cfg: Config, req: IncomingMessage): McpAuthResult {
  const cf = requireCfServiceClient(cfg, req);
  if (!cf.ok) return cf;

  if (!cfg.webhookSecret) return { ok: false, status: 403, reason: "Webhook is not configured" };
  const header = req.headers["x-webhook-secret"];
  const presented = (Array.isArray(header) ? header[0] : header) ?? req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!presented || !tokenEquals(presented, cfg.webhookSecret)) {
    return { ok: false, status: 401, reason: "Invalid webhook secret" };
  }
  return { ok: true, clientId: cf.clientId };
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
