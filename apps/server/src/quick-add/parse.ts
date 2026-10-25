import type { Config } from "../config";
import { llmConfig, llmConfigured } from "../config";
import { chatCompletion, type FetchLike } from "../llm/provider";
import { ValidationError } from "../settings";
import { QUICK_ADD_LLM_NOT_CONFIGURED } from "./errors";
import { QUICK_ADD_TZ, extractJsonObject, parseQuickAddPayload, previewFieldsForItem, type QuickAddItem } from "./normalize";

export type QuickAddCompletion = (
  cfg: NonNullable<ReturnType<typeof llmConfig>>,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  fetchFn?: FetchLike,
) => Promise<string>;

function systemPrompt(): string {
  return [
    "You extract tasks and calendar events from natural language.",
    "Return strict JSON only, no markdown, with shape:",
    '{"items":[{"kind":"task"|"event","title":string,"due"?:ISO date or datetime,"start"?:ISO date or datetime,"end"?:ISO date or datetime,"durationMinutes"?:number,"notes"?:string}]}',
    `Interpret relative dates using the user's timezone ${QUICK_ADD_TZ} and the provided current time.`,
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
  const chicagoNow = new Intl.DateTimeFormat("en-US", {
    timeZone: QUICK_ADD_TZ,
    dateStyle: "full",
    timeStyle: "long",
  }).format(now);
  const raw = await complete(llm, [
    { role: "system", content: systemPrompt() },
    { role: "user", content: JSON.stringify({ nowUtc: now.toISOString(), nowInTimezone: chicagoNow, timezone: QUICK_ADD_TZ, text: trimmed }) },
  ], deps.fetchFn);
  const parsed = parseQuickAddPayload(extractJsonObject(raw));
  return parsed.map(previewFieldsForItem);
}
