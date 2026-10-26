import type { Config } from "../config";
import { llmConfig, llmConfigured } from "../config";
import { chatCompletion, type FetchLike } from "../llm/provider";
import { ValidationError } from "../settings";
import { QUICK_ADD_LLM_NOT_CONFIGURED } from "./errors";
import { extractJsonObject, parseQuickAddPayload, previewFieldsForItem, type QuickAddItem } from "./normalize";

export type QuickAddCompletion = (
  cfg: NonNullable<ReturnType<typeof llmConfig>>,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  fetchFn?: FetchLike,
) => Promise<string>;

function systemPrompt(timezone: string): string {
  return [
    "You extract tasks and calendar events from natural language.",
    "Return strict JSON only, no markdown, with shape:",
    '{"items":[{"kind":"task"|"event","title":string,"due"?:ISO date or datetime,"start"?:ISO date or datetime,"end"?:ISO date or datetime,"durationMinutes"?:number,"notes"?:string}]}',
    `Interpret relative dates using the user's timezone ${timezone} and the provided current time.`,
    "Tasks are native Board cards with date-only deadlines (YYYY-MM-DD), not Todoist tasks. Use events for specific times.",
    "Use kind task for todos and kind event for meetings or appointments with a time block.",
    "Prefer ISO-8601 datetimes with timezone offset or Z when a specific time is implied.",
    "Do not invent items that are not clearly requested.",
  ].join(" ");
}

export async function parseQuickAddText(
  cfg: Config,
  text: string,
  deps: { complete?: QuickAddCompletion; fetchFn?: FetchLike; now?: Date } = {},
): Promise<QuickAddItem[]> {
  if (!llmConfigured(cfg)) throw new ValidationError(QUICK_ADD_LLM_NOT_CONFIGURED);
  const trimmed = text.trim();
  if (!trimmed) throw new ValidationError("text is required");
  if (trimmed.length > 4_000) throw new ValidationError("text is too long");
  const llm = llmConfig(cfg)!;
  const complete = deps.complete ?? chatCompletion;
  const now = deps.now ?? new Date();
  const localNow = new Intl.DateTimeFormat("en-US", {
    timeZone: cfg.tz,
    dateStyle: "full",
    timeStyle: "long",
  }).format(now);
  const raw = await complete(llm, [
    { role: "system", content: systemPrompt(cfg.tz) },
    { role: "user", content: JSON.stringify({ nowUtc: now.toISOString(), nowInTimezone: localNow, timezone: cfg.tz, text: trimmed }) },
  ], deps.fetchFn);
  const extracted = extractJsonObject(raw) as { items?: unknown[] };
  const parsed = parseQuickAddPayload({ items: Array.isArray(extracted?.items) ? extracted.items.map((item) => {
    if (!item || typeof item !== "object") return item;
    const value = item as Record<string, unknown>;
    return { ...value, version: 2, source: value.kind === "task" ? "board" : undefined, timezone: cfg.tz, operationId: randomUUID() };
  }) : extracted?.items });
  return parsed.map(previewFieldsForItem);
}
import { randomUUID } from "node:crypto";
