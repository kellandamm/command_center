import { safeFetch } from "../ssrf";
import type { AgentConnection } from "./store";

export interface AgentChatAdapter {
  readonly id: AgentConnection["adapter"];
  complete(
    agent: AgentConnection,
    apiKey: string,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  ): Promise<string>;
}

export class AgentAdapterError extends Error {}

export function createOpenAICompatibleAdapter(fetcher: typeof safeFetch = safeFetch): AgentChatAdapter {
  return {
    id: "openai-compatible",
    async complete(agent, apiKey, messages) {
      let result: Awaited<ReturnType<typeof safeFetch>>;
      try {
        result = await fetcher(`${agent.baseUrl}/chat/completions`, {
          method: "POST",
          timeoutMs: 90_000,
          maxBytes: 1_000_000,
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ model: agent.model, messages, temperature: 0.3 }),
        });
      } catch (error) {
        throw new AgentAdapterError(error instanceof Error ? error.message : "Could not reach agent endpoint.");
      }
      let body: unknown;
      try {
        body = JSON.parse(result.body);
      } catch {
        throw new AgentAdapterError(`Agent endpoint returned non-JSON (HTTP ${result.status}).`);
      }
      if (result.status < 200 || result.status >= 300) {
        const record = body && typeof body === "object" ? body as { error?: { message?: unknown }; message?: unknown } : {};
        const message = record.error?.message ?? record.message;
        const safeMessage = typeof message === "string"
          ? message.slice(0, 500).split(apiKey).join("[redacted]")
          : `Agent endpoint failed (HTTP ${result.status}).`;
        throw new AgentAdapterError(safeMessage);
      }
      const choice = body && typeof body === "object"
        ? (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]
        : undefined;
      const content = choice?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new AgentAdapterError("Agent endpoint returned no text reply. Tool-call responses are not supported by this adapter.");
      }
      return content.trim();
    },
  };
}

const adapters = new Map<AgentConnection["adapter"], AgentChatAdapter>([
  ["openai-compatible", createOpenAICompatibleAdapter()],
]);

export function agentChatAdapter(id: AgentConnection["adapter"]): AgentChatAdapter {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`Unsupported agent adapter: ${id}`);
  return adapter;
}
