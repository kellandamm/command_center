import { test } from "node:test";
import assert from "node:assert/strict";
import { chatCompletion } from "../src/llm/provider";

test("provider: chat completions parses OpenAI-style response", async () => {
  const fetchFn = async () =>
    ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "Hello briefing" } }] }),
    }) as Response;
  const out = await chatCompletion({ baseUrl: "https://api.example/v1", apiKey: "k", model: "m" }, [{ role: "user", content: "hi" }], fetchFn);
  assert.equal(out, "Hello briefing");
});

test("provider: surfaces API errors", async () => {
  const fetchFn = async () =>
    ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: "bad key" } }),
    }) as Response;
  await assert.rejects(
    chatCompletion({ baseUrl: "https://api.example/v1", apiKey: "k", model: "m" }, [{ role: "user", content: "hi" }], fetchFn),
    /bad key/,
  );
});
