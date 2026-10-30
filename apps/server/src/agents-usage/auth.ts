import type { IncomingMessage } from "node:http";
import { bearerToken, tokenEquals } from "../auth";
import type { Config } from "../config";
import {
  accessJwtFromRequest,
  cfAccessConfigured,
  createCfAccessRemoteJwtVerifier,
  serviceTokenClientIdFromPayload,
  type CfAccessJwtVerifier,
} from "../cf-access";
import type { McpAuthResult } from "../mcp/auth";
import { setIntegrationCfAccessVerifier } from "../mcp/auth";

export { setIntegrationCfAccessVerifier };

let testVerifierOverride: CfAccessJwtVerifier | null | undefined;
const remoteVerifierCache = new Map<string, CfAccessJwtVerifier | null>();

/** Tests: local JWKS verifier (same hook pattern as MCP integration tests). */
export function setAgentsUsageCfAccessVerifierForTests(verifier: CfAccessJwtVerifier | null | undefined): void {
  testVerifierOverride = verifier;
  setIntegrationCfAccessVerifier(verifier);
  remoteVerifierCache.clear();
}

function verifierCacheKey(cfg: Config): string {
  return `${cfg.cfTeamDomain ?? ""}|${cfg.cfAud?.join(",") ?? ""}`;
}

function resolveVerifier(cfg: Config): CfAccessJwtVerifier | null {
  if (testVerifierOverride !== undefined) return testVerifierOverride;
  const key = verifierCacheKey(cfg);
  if (!remoteVerifierCache.has(key)) {
    remoteVerifierCache.set(key, createCfAccessRemoteJwtVerifier(cfg));
  }
  return remoteVerifierCache.get(key) ?? null;
}

/**
 * Requires BOTH a verified Cf-Access-Jwt-Assertion (service token) AND
 * Authorization: Bearer AGENTS_USAGE_IMPORT_TOKEN (constant-time compare).
 */
export async function authenticateAgentsUsageImport(cfg: Config, req: IncomingMessage): Promise<McpAuthResult> {
  const importToken = cfg.agentsUsageImportToken;
  if (!importToken) {
    return { ok: false, status: 503, reason: "Agents usage import is not configured" };
  }

  if (!cfAccessConfigured(cfg)) {
    return { ok: false, status: 503, reason: "Cloudflare Access is required for agents usage import" };
  }

  const jwt = accessJwtFromRequest(req.headers);
  if (!jwt) {
    return { ok: false, status: 401, reason: "Cf-Access-Jwt-Assertion required" };
  }

  const verify = resolveVerifier(cfg);
  if (!verify) {
    return { ok: false, status: 503, reason: "Cloudflare Access JWT verification is not configured" };
  }

  let payload;
  try {
    payload = await verify(jwt);
  } catch {
    return { ok: false, status: 401, reason: "Invalid or expired Cloudflare Access JWT" };
  }

  const serviceId = serviceTokenClientIdFromPayload(payload);
  if (!serviceId) {
    return { ok: false, status: 401, reason: "Access service token required" };
  }
  if (typeof payload.email === "string" && payload.email.trim()) {
    return { ok: false, status: 401, reason: "User identity JWT not allowed for usage import" };
  }

  const allowed = cfg.agentsUsageImportClientIds;
  if (allowed.length && !allowed.includes(serviceId)) {
    return { ok: false, status: 401, reason: "Access service token is not allowed for usage import" };
  }

  const bearer = bearerToken(req);
  if (!bearer) {
    return { ok: false, status: 401, reason: "Bearer import token required" };
  }
  if (!tokenEquals(bearer, importToken)) {
    return { ok: false, status: 401, reason: "Invalid import token" };
  }

  return { ok: true, clientId: serviceId };
}
