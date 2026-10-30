import type { IncomingMessage } from "node:http";
import { bearerToken, tokenEquals } from "../auth";
import type { Config } from "../config";
import {
  accessJwtFromRequest,
  cfAccessConfigured,
  createCfAccessRemoteJwtVerifier,
} from "../cf-access";
import type { McpAuthResult } from "../mcp/auth";
import { setIntegrationCfAccessVerifier } from "../mcp/auth";

export { setIntegrationCfAccessVerifier };

let testVerifierOverride: ReturnType<typeof createCfAccessRemoteJwtVerifier> | null | undefined;

/** Tests: local JWKS verifier (same hook pattern as MCP integration tests). */
export function setAgentsUsageCfAccessVerifierForTests(
  verifier: ReturnType<typeof createCfAccessRemoteJwtVerifier> | null | undefined,
): void {
  testVerifierOverride = verifier;
  setIntegrationCfAccessVerifier(verifier);
}

function resolveVerifier(cfg: Config) {
  if (testVerifierOverride !== undefined) return testVerifierOverride;
  return createCfAccessRemoteJwtVerifier(cfg);
}

/**
 * Requires BOTH a verified Cf-Access-Jwt-Assertion (service token) AND
 * Authorization: Bearer AGENTS_USAGE_IMPORT_TOKEN (constant-time compare).
 * MCP app tokens are not accepted.
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

  try {
    await verify(jwt);
  } catch {
    return { ok: false, status: 401, reason: "Invalid or expired Cloudflare Access JWT" };
  }

  const bearer = bearerToken(req);
  if (!bearer) {
    return { ok: false, status: 401, reason: "Bearer import token required" };
  }
  if (!tokenEquals(bearer, importToken)) {
    return { ok: false, status: 401, reason: "Invalid import token" };
  }

  return { ok: true, clientId: "agents-usage-import" };
}
