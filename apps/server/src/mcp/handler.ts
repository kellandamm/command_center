import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IntegrationDeps } from "./actions";
import { authenticateMcp } from "./auth";
import { createCommandCenterMcp } from "./create-server";
import { McpRateLimiter } from "./rate-limit";

const limiter = new McpRateLimiter();

const SECURITY = {
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

export async function handleMcpRoute(
  deps: IntegrationDeps,
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown,
): Promise<void> {
  const auth = authenticateMcp(deps.cfg, req);
  if (!auth.ok) {
    res.writeHead(auth.status, { "content-type": "application/json", ...SECURITY });
    res.end(JSON.stringify({ error: auth.reason }));
    return;
  }
  if (!limiter.allow(auth.clientId)) {
    res.writeHead(429, { "content-type": "application/json", ...SECURITY });
    res.end(JSON.stringify({ error: "rate limit exceeded" }));
    return;
  }

  if (req.method === "GET" || req.method === "DELETE") {
    res.writeHead(405, { "content-type": "application/json", ...SECURITY });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json", ...SECURITY });
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  const server = createCommandCenterMcp(deps, auth.clientId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
  } catch (err) {
    console.error("mcp request failed:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json", ...SECURITY });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
    }
  }
}
