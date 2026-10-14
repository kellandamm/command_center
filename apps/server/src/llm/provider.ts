import type { LlmConfig } from "../config";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type FetchLike = typeof fetch;

export async function chatCompletion(
  cfg: LlmConfig,
  messages: ChatMessage[],
  fetchFn: FetchLike = fetch,
): Promise<string> {
  const url = `${cfg.baseUrl}/chat/completions`;
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.3 }),
  });
  const body = await res.text();
  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`LLM returned non-JSON (${res.status})`);
  }
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.message ?? body.slice(0, 200);
    throw new Error(typeof msg === "string" ? msg : `LLM error HTTP ${res.status}`);
  }
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("LLM returned empty completion");
  return content.trim();
}
