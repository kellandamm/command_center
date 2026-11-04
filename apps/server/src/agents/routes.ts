import type { IncomingMessage, ServerResponse } from "node:http";
import type { ConnectionsStore } from "../connections";
import { assertPublicUrl } from "../ssrf";
import type { AgentConnection } from "./store";
import { AgentHubStore } from "./store";
import { AgentAdapterError, agentChatAdapter } from "./adapters";

type ReadBody = (req: IncomingMessage, limit?: number) => Promise<unknown>;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\r\n\0]/.test(value)) {
    throw new Error(`${name} must be a non-empty single-line value of at most ${maxLength} characters.`);
  }
  return value.trim();
}

export async function validateAgentBaseUrl(value: unknown): Promise<string> {
  const raw = text(value, "API base URL", 2048).replace(/\/+$/, "");
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error("API base URL must be a valid HTTPS URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("API base URL must use HTTPS and cannot include credentials, a query, or a fragment.");
  }
  try { await assertPublicUrl(url.href); }
  catch { throw new Error("API base URL must resolve to a public internet address."); }
  return url.href.replace(/\/+$/, "");
}

function connectionInput(
  body: Record<string, unknown>,
  current?: AgentConnection,
): Omit<AgentConnection, "id" | "createdAt" | "updatedAt" | "baseUrl"> {
  const adapter = body.adapter ?? current?.adapter ?? "openai-compatible";
  if (adapter !== "openai-compatible") throw new Error("Unsupported agent adapter.");
  return {
    name: text(body.name ?? current?.name, "Agent name", 80),
    adapter: "openai-compatible",
    model: text(body.model ?? current?.model, "Model", 200),
    systemPrompt: body.systemPrompt === undefined
      ? current?.systemPrompt ?? ""
      : typeof body.systemPrompt === "string" && body.systemPrompt.length <= 4_000 && !/\0/.test(body.systemPrompt)
        ? body.systemPrompt.trim() : (() => { throw new Error("System prompt must be 4,000 characters or fewer."); })(),
  };
}

function publicAgent(agent: AgentConnection, configured: boolean, owner: boolean) {
  const { systemPrompt, ...safeAgent } = agent;
  return { ...safeAgent, ...(owner ? { systemPrompt } : {}), credentialConfigured: configured };
}

export async function handleAgentRoutes(
  hub: AgentHubStore,
  connections: ConnectionsStore | undefined,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  owner: boolean,
  userId: string,
  readBody: ReadBody,
): Promise<boolean> {
  // Only claim agent-chat paths; /api/agents/usage* belongs to the agents-usage routes.
  if (path !== "/api/agents" && !/^\/api\/agents\/[0-9a-f-]{36}(\/|$)/i.test(path)) return false;
  const managesAgent = (path === "/api/agents" && req.method === "POST")
    || (/^\/api\/agents\/[0-9a-f-]{36}$/i.test(path) && ["PUT", "DELETE"].includes(req.method ?? ""));
  if (managesAgent && !owner) {
    json(res, 403, { error: "owner login required" });
    return true;
  }
  if (!connections) {
    json(res, 503, { error: "Encrypted agent connection storage is unavailable." });
    return true;
  }
  if (managesAgent && !connections.status().writable) {
    json(res, 503, { error: "Set CONNECTIONS_MASTER_KEY to enable encrypted agent credentials." });
    return true;
  }

  if (path === "/api/agents" && req.method === "GET") {
    const agents = hub.listAgents().map((agent) => publicAgent(agent, !!connections.secret(`agents/${agent.id}`), owner));
    json(res, 200, { agents, canManage: owner, credentialStorageWritable: connections.status().writable });
    return true;
  }

  if (path === "/api/agents" && req.method === "POST") {
    if (!owner) return json(res, 403, { error: "owner login required" }), true;
    try {
      const body = object(await readBody(req, 32_000));
      if (!body) throw new Error("Request body must be an object.");
      const input = connectionInput(body);
      const baseUrl = await validateAgentBaseUrl(body.baseUrl);
      const apiKey = text(body.apiKey, "API key", 4096);
      if (body.adapter !== undefined && body.adapter !== "openai-compatible") throw new Error("Unsupported agent adapter.");
      const agent = await hub.addAgent({ ...input, baseUrl });
      try {
        await connections.setSecret(`agents/${agent.id}`, apiKey);
      } catch (error) {
        await hub.removeAgent(agent.id);
        throw error;
      }
      json(res, 201, { agent: publicAgent(agent, true, true) });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Agent could not be connected." });
    }
    return true;
  }

  const agentMatch = path.match(/^\/api\/agents\/([0-9a-f-]{36})$/i);
  if (agentMatch && ["PUT", "DELETE"].includes(req.method ?? "")) {
    if (!owner) return json(res, 403, { error: "owner login required" }), true;
    const id = agentMatch[1]!;
    if (req.method === "DELETE") {
      if (!hub.getAgent(id)) return json(res, 404, { error: "Agent not found." }), true;
      await connections.setSecret(`agents/${id}`, null);
      await hub.removeAgent(id);
      json(res, 200, { ok: true });
      return true;
    }
    try {
      const current = hub.getAgent(id);
      if (!current) return json(res, 404, { error: "Agent not found." }), true;
      const body = object(await readBody(req, 32_000));
      if (!body) throw new Error("Request body must be an object.");
      const input = connectionInput(body, current);
      const baseUrl = body.baseUrl === undefined ? current.baseUrl : await validateAgentBaseUrl(body.baseUrl);
      const apiKey = body.apiKey === undefined || body.apiKey === "" ? undefined : text(body.apiKey, "API key", 4096);
      if (body.adapter !== undefined && body.adapter !== "openai-compatible") throw new Error("Unsupported agent adapter.");
      if (apiKey) await connections.setSecret(`agents/${id}`, apiKey);
      const updated = await hub.updateAgent(id, { ...input, baseUrl });
      if (!updated) return json(res, 404, { error: "Agent not found." }), true;
      json(res, 200, { agent: publicAgent(updated, !!(apiKey || connections.secret(`agents/${id}`)), true) });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Agent could not be updated." });
    }
    return true;
  }

  const conversationsMatch = path.match(/^\/api\/agents\/([0-9a-f-]{36})\/conversations$/i);
  if (conversationsMatch && ["GET", "POST"].includes(req.method ?? "")) {
    const agentId = conversationsMatch[1]!;
    if (!hub.getAgent(agentId)) return json(res, 404, { error: "Agent not found." }), true;
    if (req.method === "GET") {
      json(res, 200, { conversations: hub.listConversations(agentId, userId) });
    } else {
      try {
        const body = object(await readBody(req));
        if (body?.title !== undefined && typeof body.title !== "string") throw new Error("Title must be text.");
        const conversation = await hub.createConversation(agentId, userId, body?.title as string | undefined);
        json(res, 201, { conversation });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : "Conversation could not be created." });
      }
    }
    return true;
  }

  const conversationMatch = path.match(/^\/api\/agents\/([0-9a-f-]{36})\/conversations\/([0-9a-f-]{36})$/i);
  if (conversationMatch && req.method === "GET") {
    const conversation = hub.getConversation(conversationMatch[1]!, conversationMatch[2]!, userId);
    if (!conversation) return json(res, 404, { error: "Conversation not found." }), true;
    json(res, 200, { conversation });
    return true;
  }

  const messageMatch = path.match(/^\/api\/agents\/([0-9a-f-]{36})\/conversations\/([0-9a-f-]{36})\/messages$/i);
  if (messageMatch && req.method === "POST") {
    const agent = hub.getAgent(messageMatch[1]!);
    if (!agent) return json(res, 404, { error: "Agent not found." }), true;
    const apiKey = connections.secret(`agents/${agent.id}`);
    if (!apiKey) return json(res, 409, { error: "Agent credential is missing. Update the agent connection first." }), true;
    try {
      const body = object(await readBody(req, 24_000));
      if (!body) throw new Error("Request body must be an object.");
      const content = text(body.content, "Message", 16_000);
      const adapter = agentChatAdapter(agent.adapter);
      const conversation = await hub.sendMessage(
        agent.id,
        messageMatch[2]!,
        userId,
        content,
        (messages) => adapter.complete(agent, apiKey, messages),
      );
      json(res, 200, { conversation });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent did not respond.";
      json(res, error instanceof AgentAdapterError ? 502 : 400, { error: message });
    }
    return true;
  }

  json(res, 404, { error: "Agent route not found." });
  return true;
}
