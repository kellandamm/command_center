import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHubStore, type AgentConnection } from "../src/agents/store";
import { createOpenAICompatibleAdapter } from "../src/agents/adapters";
import { handleAgentRoutes, validateAgentBaseUrl } from "../src/agents/routes";
import { ConnectionsStore } from "../src/connections";
import { loadConfig } from "../src/config";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const agentInput = {
  name: "Research agent",
  adapter: "openai-compatible" as const,
  baseUrl: "https://api.example.com/v1",
  model: "example/chat-model",
  systemPrompt: "Answer concisely.",
};

test("agent conversations persist with ordered context and remain private per user", async () => {
  const dir = await tempDir("agent-hub-");
  let hub = await AgentHubStore.open(dir);
  const agent = await hub.addAgent(agentInput);
  const conversation = await hub.createConversation(agent.id, "owner@example.com");
  const reply = async (messages: Array<{ role: string; content: string }>) => `reply:${messages[messages.length - 1]!.content}`;

  const first = await hub.sendMessage(agent.id, conversation.id, "owner@example.com", "First question", reply);
  assert.equal(first.title, "First question");
  assert.deepEqual(first.messages.map((message) => message.role), ["user", "assistant"]);

  await Promise.all([
    hub.sendMessage(agent.id, conversation.id, "owner@example.com", "Second question", reply),
    hub.sendMessage(agent.id, conversation.id, "owner@example.com", "Third question", reply),
  ]);
  hub = await AgentHubStore.open(dir);
  const restored = hub.getConversation(agent.id, conversation.id, "owner@example.com");
  assert.ok(restored);
  assert.equal(restored.messages.length, 6);
  assert.deepEqual(restored.messages.filter((message) => message.role === "user").map((message) => message.content), [
    "First question", "Second question", "Third question",
  ]);
  assert.equal(hub.getConversation(agent.id, conversation.id, "another-user"), undefined);
  assert.deepEqual(hub.listConversations(agent.id, "another-user"), []);
});

test("agent chat adapter sends OpenAI-compatible requests and redacts provider errors", async () => {
  const agent: AgentConnection = {
    ...agentInput,
    id: "agent-1",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  let requestUrl = "";
  let requestBody = "";
  let requestAuthorization = "";
  const adapter = createOpenAICompatibleAdapter(async (url, options) => {
    requestUrl = url;
    requestBody = options?.body ?? "";
    requestAuthorization = options?.headers?.authorization ?? "";
    return {
      finalUrl: url,
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: "A useful reply." } }] }),
      headers: {},
    };
  });
  const messages = [{ role: "user" as const, content: "Hello" }];
  assert.equal(await adapter.complete(agent, "secret-key", messages), "A useful reply.");
  assert.equal(requestUrl, "https://api.example.com/v1/chat/completions");
  assert.equal(requestAuthorization, "Bearer secret-key");
  assert.deepEqual(JSON.parse(requestBody), { model: agent.model, messages, temperature: 0.3 });

  const failing = createOpenAICompatibleAdapter(async () => ({
    finalUrl: "https://api.example.com/v1/chat/completions",
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: { message: "Invalid key: secret-key" } }),
    headers: {},
  }));
  await assert.rejects(failing.complete(agent, "secret-key", messages), (error: Error) => {
    assert.match(error.message, /redacted/);
    assert.doesNotMatch(error.message, /secret-key/);
    return true;
  });

  const toolCall = createOpenAICompatibleAdapter(async () => ({
    finalUrl: "https://api.example.com/v1/chat/completions",
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ choices: [{ message: { tool_calls: [{ type: "function" }] } }] }),
    headers: {},
  }));
  await assert.rejects(toolCall.complete(agent, "secret-key", messages), /Tool-call responses are not supported/);
});

test("agent credentials use the encrypted connections vault", async () => {
  const dir = await tempDir("agent-vault-");
  const config = loadConfig({ DATA_DIR: dir, CONNECTIONS_MASTER_KEY: "a".repeat(64) });
  const connections = await ConnectionsStore.open(config);
  await connections.setSecret("agents/agent-1", "agent-secret-value");
  assert.equal(connections.secret("agents/agent-1"), "agent-secret-value");
  const encrypted = await readFile(join(dir, "connections.enc.json"), "utf8");
  assert.doesNotMatch(encrypted, /agent-secret-value/);
  const restored = await ConnectionsStore.open(config);
  assert.equal(restored.secret("agents/agent-1"), "agent-secret-value");
});

test("agent registration validation requires HTTPS and rejects private endpoints", async () => {
  await assert.rejects(validateAgentBaseUrl("http://api.example.com"), /must use HTTPS/);
  await assert.rejects(validateAgentBaseUrl("https://127.0.0.1"), /public internet address/);
});

test("agent chat routes leave /api/agents/usage to the usage routes", async () => {
  const hub = await AgentHubStore.open(await tempDir("cc-agent-paths-"));
  const req = { method: "GET" } as never;
  const res = {} as never;
  const readBody = (async () => ({})) as never;
  for (const path of ["/api/agents/usage", "/api/agents/usage/history", "/api/agents/usage/checkins"]) {
    assert.equal(await handleAgentRoutes(hub, undefined, req, res, path, false, "reader", readBody), false);
  }
});
