import type { IncomingMessage } from "node:http";
import { tokenEquals } from "../auth";
import type { CfAccessJwtVerifier } from "../cf-access";
import {
  accessJwtFromRequest,
  cfAccessConfigured,
  createCfAccessRemoteJwtVerifier,
  serviceTokenClientIdFromPayload,
} from "../cf-access";
import type { Config } from "../config";
import { mcpClientIdForCfAccessClientId, mcpConfigured, resolveMcpClientFromBearer } from "../config";

export type McpAuthResult = { ok: true; clientId: string } | { ok: false; status: 401 | 403; reason: string };

let integrationJwtVerifier: CfAccessJwtVerifier | null | undefined;

/** Override JWT verification in tests (local JWKS). Production uses remote team certs. */
export function setIntegrationCfAccessVerifier(verifier: CfAccessJwtVerifier | null | undefined): void {
  integrationJwtVerifier = verifier;
}

function resolveIntegrationVerifier(cfg: Config): CfAccessJwtVerifier | null {
  if (integrationJwtVerifier !== undefined) return integrationJwtVerifier;
  return createCfAccessRemoteJwtVerifier(cfg);
}

/** Integrations: non-empty map, team/AUD config, verified Access JWT, common_name → MCP client id. */
export async function requireCfServiceClient(cfg: Config, req: IncomingMessage): Promise<McpAuthResult> {
  if (Object.keys(cfg.mcpCfClientMap).length === 0) {
    return { ok: false, status: 403, reason: "MCP_CF_CLIENT_MAP is required for integrations" };
  }
  if (!cfAccessConfigured(cfg)) {
    return { ok: false, status: 403, reason: "CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required for integrations" };
  }

  const token = accessJwtFromRequest(req.headers);
  if (!token) return { ok: false, status: 403, reason: "Cf-Access-Jwt-Assertion required" };

  const verify = resolveIntegrationVerifier(cfg);
  if (!verify) return { ok: false, status: 403, reason: "Cloudflare Access JWT verification is not configured" };

  let payload;
  try {
    payload = await verify(token);
  } catch {
    return { ok: false, status: 403, reason: "Invalid or expired Cloudflare Access JWT" };
  }

  const serviceId = serviceTokenClientIdFromPayload(payload);
  if (!serviceId) return { ok: false, status: 403, reason: "Access JWT missing common_name" };

  const mapped = mcpClientIdForCfAccessClientId(cfg, serviceId);
  if (!mapped) return { ok: false, status: 403, reason: "Unknown Cloudflare Access service token" };
  return { ok: true, clientId: mapped };
}

export async function authenticateMcp(cfg: Config, req: IncomingMessage): Promise<McpAuthResult> {
  const cf = await requireCfServiceClient(cfg, req);
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

/** X bookmarks import: verified Access JWT plus BOOKMARKS_IMPORT_SECRET (X-Bookmarks-Secret). */
export async function authenticateBookmarksImport(cfg: Config, req: IncomingMessage): Promise<McpAuthResult> {
  if (!cfg.bookmarksImportSecret) return { ok: false, status: 403, reason: "Bookmarks import is not configured" };
  if (!cfAccessConfigured(cfg)) {
    return { ok: false, status: 403, reason: "CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required for bookmarks import" };
  }
  const token = accessJwtFromRequest(req.headers);
  if (!token) return { ok: false, status: 403, reason: "Cf-Access-Jwt-Assertion required" };
  const verify = resolveIntegrationVerifier(cfg);
  if (!verify) return { ok: false, status: 403, reason: "Cloudflare Access JWT verification is not configured" };
  try {
    await verify(token);
  } catch {
    return { ok: false, status: 403, reason: "Invalid or expired Cloudflare Access JWT" };
  }
  const header = req.headers["x-bookmarks-secret"];
  const presented = (Array.isArray(header) ? header[0] : header) ?? "";
  if (!presented || !tokenEquals(presented, cfg.bookmarksImportSecret)) {
    return { ok: false, status: 401, reason: "Invalid bookmarks import secret" };
  }
  return { ok: true, clientId: "bookmarks-import" };
}

export async function authenticateWebhook(cfg: Config, req: IncomingMessage): Promise<McpAuthResult> {
  const cf = await requireCfServiceClient(cfg, req);
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
