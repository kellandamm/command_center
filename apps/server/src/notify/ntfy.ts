import type { Config } from "../config";
import { safeFetch } from "../ssrf";
import { inQuietHours, parseQuietHours } from "./quiet-hours";

export type NotifyPriority = "min" | "low" | "default" | "high" | "max";

export interface NotifyInput {
  title: string;
  body: string;
  priority?: NotifyPriority;
  tags?: string[];
  click?: string;
}

export interface NtfyRuntime {
  enabled: boolean;
  url: string;
  topic: string | null;
  token: string | null;
  reminderMinutes: number;
  quietHours: ReturnType<typeof parseQuietHours>;
  publicBaseUrl: string | null;
  tz: string;
}

const DEFAULT_URL = "https://ntfy.sh";
const TIMEOUT_MS = 8_000;

export function maskNtfyTopic(topic: string): string {
  const t = topic.trim();
  if (t.length <= 4) return "••••";
  return `${t.slice(0, 2)}•••${t.slice(-2)}`;
}

/** Env-backed deployment config wins over connection-vault overrides on `effective`. */
export function resolveNtfyRuntime(deployment: Config, effective: Config = deployment): NtfyRuntime {
  const topic = deployment.ntfyTopic ?? effective.ntfyTopic;
  const url = (deployment.ntfyUrl ?? effective.ntfyUrl ?? DEFAULT_URL).replace(/\/+$/, "");
  const token = deployment.ntfyToken ?? effective.ntfyToken;
  return {
    enabled: Boolean(topic?.trim()),
    url,
    topic: topic?.trim() ?? null,
    token: token ?? null,
    reminderMinutes: deployment.ntfyReminderMinutes,
    quietHours: parseQuietHours(deployment.ntfyQuietHours),
    publicBaseUrl: deployment.appPublicUrl,
    tz: deployment.tz,
  };
}

export function ntfyStatus(runtime: NtfyRuntime): { enabled: boolean; topicMasked: string | null } {
  return {
    enabled: runtime.enabled,
    topicMasked: runtime.topic ? maskNtfyTopic(runtime.topic) : null,
  };
}

export function shouldSendDuringQuietHours(runtime: NtfyRuntime, priority: NotifyPriority, now: Date): boolean {
  if (!runtime.quietHours) return true;
  if (!inQuietHours(now, runtime.tz, runtime.quietHours)) return true;
  return priority === "high" || priority === "max";
}

export async function notify(runtime: NtfyRuntime, input: NotifyInput): Promise<boolean> {
  if (!runtime.enabled || !runtime.topic) return false;
  const priority = input.priority ?? "default";
  const url = `${runtime.url}/${encodeURIComponent(runtime.topic)}`;
  const headers: Record<string, string> = {
    Title: input.title.slice(0, 200),
    Priority: priority,
    "Content-Type": "text/plain; charset=utf-8",
  };
  if (input.tags?.length) headers.Tags = input.tags.slice(0, 5).join(",");
  if (input.click) headers.Click = input.click.slice(0, 2_000);
  if (runtime.token) headers.Authorization = `Bearer ${runtime.token}`;
  try {
    const res = await safeFetch(url, {
      method: "POST",
      headers,
      body: input.body.slice(0, 4_000),
      timeoutMs: TIMEOUT_MS,
      maxBytes: 4_096,
      maxRedirects: 0,
    });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

export async function notifyIfAllowed(runtime: NtfyRuntime, input: NotifyInput, now: Date): Promise<boolean> {
  const priority = input.priority ?? "default";
  if (!shouldSendDuringQuietHours(runtime, priority, now)) return false;
  return notify(runtime, input);
}
