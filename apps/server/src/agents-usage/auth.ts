import type { IncomingMessage } from "node:http";
import type { Config } from "../config";
import {
  authenticateCfAccessBearerImport,
  setCfAccessBearerImportVerifierForTests,
} from "../cf-access-bearer-import-auth";
import type { McpAuthResult } from "../mcp/auth";
import type { CfAccessJwtVerifier } from "../cf-access";

export { setIntegrationCfAccessVerifier } from "../mcp/auth";

export function setAgentsUsageCfAccessVerifierForTests(verifier: CfAccessJwtVerifier | null | undefined): void {
  setCfAccessBearerImportVerifierForTests(verifier);
}

/**
 * Requires BOTH a verified Cf-Access-Jwt-Assertion (service token) AND
 * Authorization: Bearer AGENTS_USAGE_IMPORT_TOKEN (constant-time compare).
 */
export async function authenticateAgentsUsageImport(cfg: Config, req: IncomingMessage): Promise<McpAuthResult> {
  return authenticateCfAccessBearerImport({
    cfg,
    req,
    importToken: cfg.agentsUsageImportToken,
    notConfiguredReason: "Agents usage import is not configured",
    cfRequiredReason: "Cloudflare Access is required for agents usage import",
    allowedClientIds: cfg.agentsUsageImportClientIds,
    notAllowedReason: "Access service token is not allowed for usage import",
    userJwtNotAllowedReason: "User identity JWT not allowed for usage import",
  });
}
