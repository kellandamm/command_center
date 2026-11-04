import type { IncomingMessage } from "node:http";
import type { Config } from "../../config";
import { authenticateCfAccessBearerImport } from "../../cf-access-bearer-import-auth";
import type { McpAuthResult } from "../../mcp/auth";

export async function authenticateTeamUpdateImport(cfg: Config, req: IncomingMessage): Promise<McpAuthResult> {
  return authenticateCfAccessBearerImport({
    cfg,
    req,
    importToken: cfg.teamUpdateImportToken,
    notConfiguredReason: "Team update import is not configured",
    cfRequiredReason: "Cloudflare Access is required for team update import",
    allowedClientIds: cfg.teamUpdateImportClientIds,
    notAllowedReason: "Access service token is not allowed for team update import",
  });
}
