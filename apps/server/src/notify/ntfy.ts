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

export interface NtfyResolved {
  enabled: boolean;
  /** Base URL used for publish (no trailing slash). */
  publishBase: string;
  topic: string | null;
  token: string | null;
  reminderMinutes: number;
  quietHours: ReturnType<typeof parseQuietHours>;
  publicBaseUrl: string | null;
  coachEnabled: boolean;
  /** When set, this exact origin may be reached without public DNS checks (env-only). */
  envOrigin: string | null;
}

const DEFAULT_URL = "https://ntfy.sh";
const TIMEOUT_MS = 8_000;

const PRIORITY_NUM: Record<NotifyPriority, number> = {
  min: 1,
  low: 2,
  default: 3,
  high: 4,
  max: 5,
};

export type NtfyHttpResult = { status: number };

export type NtfyTransport = (
  url: string,
  opts: {
    method: string;
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
    envOrigin: string | null;
  },
) => Promise<NtfyHttpResult>;

let transportOverride: NtfyTransport | null = null;

/** Test-only: bypass DNS/network (no real fetch). */
export function setNtfyTransportForTests(transport: NtfyTransport | null): void {
  transportOverride = transport;
}

function originOf(base: string): string | null {
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

async function defaultTransport(
  url: string,
  opts: { method: string; headers: Record<string, string>; body: string; timeoutMs: number; envOrigin: string | null },
): Promise<NtfyHttpResult> {
  const targetOrigin = originOf(url);
  if (opts.envOrigin && targetOrigin === opts.envOrigin) {
    const res = await fetch(url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    await res.body?.cancel();
    return { status: res.status };
  }
  const res = await safeFetch(url, {
    method: opts.method,
    headers: opts.headers,
    body: opts.body,
    timeoutMs: opts.timeoutMs,
    maxBytes: 4_096,
    maxRedirects: 0,
  });
  return { status: res.status };
}

export function maskNtfyTopic(topic: string): string {
  const t = topic.trim();
  if (t.length <= 4) return "••••";
  return `${t.slice(0, 2)}•••${t.slice(-2)}`;
}

/** Deployment env wins over connection-vault values on `effective`. */
export function resolveNtfyConfig(deployment: Config, effective: Config = deployment): NtfyResolved {
  const topic = deployment.ntfyTopic ?? effective.ntfyTopic;
  const publishBase = (deployment.ntfyUrl ?? effective.ntfyUrl ?? DEFAULT_URL).replace(/\/+$/, "");
  const token = deployment.ntfyToken ?? effective.ntfyToken;
  const envOrigin = deployment.ntfyUrl ? originOf(deployment.ntfyUrl.replace(/\/+$/, "")) : null;
  return {
    enabled: Boolean(topic?.trim()),
    publishBase,
    topic: topic?.trim() ?? null,
    token: token ?? null,
    reminderMinutes: deployment.ntfyReminderMinutes,
    quietHours: parseQuietHours(deployment.ntfyQuietHours),
    publicBaseUrl: deployment.appPublicUrl,
    coachEnabled: deployment.ntfyCoach,
    envOrigin,
  };
}

/** @deprecated alias */
export const resolveNtfyRuntime = resolveNtfyConfig;

export function ntfyStatus(cfg: NtfyResolved): { enabled: boolean; topicMasked: string | null } {
  return {
    enabled: cfg.enabled,
    topicMasked: cfg.topic ? maskNtfyTopic(cfg.topic) : null,
  };
}

export function shouldSendDuringQuietHours(cfg: NtfyResolved, now: Date): boolean {
  if (!cfg.quietHours) return true;
  return !inQuietHours(now, cfg.quietHours);
}

export async function notify(cfg: NtfyResolved, input: NotifyInput): Promise<boolean> {
  if (!cfg.enabled || !cfg.topic) return false;
  const transport = transportOverride ?? defaultTransport;
  const priority = input.priority ?? "default";
  const payload: Record<string, unknown> = {
    topic: cfg.topic,
    title: input.title.slice(0, 200),
    message: input.body.slice(0, 4_000),
    priority: PRIORITY_NUM[priority],
  };
  if (input.tags?.length) payload.tags = input.tags.slice(0, 5);
  if (input.click) payload.click = input.click.slice(0, 2_000);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
  const url = `${cfg.publishBase}/`;
  try {
    const res = await transport(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      timeoutMs: TIMEOUT_MS,
      envOrigin: cfg.envOrigin,
    });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

export async function notifyIfAllowed(cfg: NtfyResolved, input: NotifyInput, now: Date): Promise<boolean> {
  if (!shouldSendDuringQuietHours(cfg, now)) return false;
  return notify(cfg, input);
}
