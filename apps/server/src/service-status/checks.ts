import type { Config } from "../config";
import { todoistConfigured } from "../config";
import { safeFetch } from "../ssrf";
import { fetchEnvConfiguredUrl } from "./env-fetch";

export type ServiceState = "up" | "down" | "unknown" | "not_configured";

export interface ServiceCheckResult {
  id: string;
  label: string;
  state: ServiceState;
  latencyMs?: number;
  downFor?: string;
  version?: string;
  uptimeSec?: number;
}

const CACHE_MS = 60_000;
const CHECK_TIMEOUT_MS = 3000;

let cache: { at: number; results: ServiceCheckResult[] } | null = null;
let inflight: Promise<ServiceCheckResult[]> | null = null;

export let serverProcessStartedAt = Date.now();

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s || s.length < 4) continue;
    out = out.split(s).join("[redacted]");
  }
  return out;
}

function collectSecrets(cfg: Config): string[] {
  return [
    cfg.adminToken,
    cfg.todoistApiToken,
    cfg.haToken,
    cfg.plaudUrl,
    cfg.cfAccessClientSecret,
  ].filter((s): s is string => !!s && s.length >= 4);
}

function stremmyLabel(cfg: Config): string {
  const raw = cfg.appPublicUrl?.trim();
  if (!raw) return "Stremmy";
  try {
    return new URL(raw).hostname || "Stremmy";
  } catch {
    return "Stremmy";
  }
}

function stremmySelfResult(cfg: Config): ServiceCheckResult {
  return {
    id: "stremmy",
    label: stremmyLabel(cfg),
    state: "up",
    latencyMs: 0,
    version: cfg.version,
    uptimeSec: Math.max(0, Math.floor((Date.now() - serverProcessStartedAt) / 1000)),
  };
}

async function timedCheck(
  fn: () => Promise<{ ok: boolean; detail?: string }>,
): Promise<{ state: ServiceState; latencyMs?: number; downFor?: string }> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise<{ ok: false; detail: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, detail: "timeout" }), CHECK_TIMEOUT_MS),
      ),
    ]);
    const latencyMs = Date.now() - start;
    if (result.ok) return { state: "up", latencyMs };
    return {
      state: result.detail === "timeout" ? "unknown" : "down",
      latencyMs,
      downFor: result.detail === "timeout" ? undefined : "down",
    };
  } catch {
    return { state: "unknown", latencyMs: Date.now() - start };
  }
}

async function checkTodoist(cfg: Config): Promise<{ ok: boolean }> {
  if (!todoistConfigured(cfg)) return { ok: false };
  const { status } = await safeFetch("https://api.todoist.com/api/v1/projects", {
    timeoutMs: CHECK_TIMEOUT_MS,
    maxBytes: 4096,
    headers: { authorization: `Bearer ${cfg.todoistApiToken}` },
  });
  return { ok: status >= 200 && status < 300 };
}

async function checkPlaud(cfg: Config): Promise<{ ok: boolean }> {
  if (!cfg.plaudUrl) return { ok: false };
  const { status } = await fetchEnvConfiguredUrl(cfg.plaudUrl, "", { timeoutMs: CHECK_TIMEOUT_MS });
  return { ok: status >= 200 && status < 500 };
}

async function checkHomeAssistant(cfg: Config): Promise<{ ok: boolean }> {
  if (!cfg.haUrl || !cfg.haToken) return { ok: false };
  const { status } = await fetchEnvConfiguredUrl(cfg.haUrl, "/api/", {
    timeoutMs: CHECK_TIMEOUT_MS,
    headers: { authorization: `Bearer ${cfg.haToken}` },
  });
  return { ok: status >= 200 && status < 300 };
}

async function runChecks(cfg: Config): Promise<ServiceCheckResult[]> {
  const results: ServiceCheckResult[] = [stremmySelfResult(cfg)];

  const tail = await Promise.all([
    (async (): Promise<ServiceCheckResult> => {
      if (!cfg.haUrl || !cfg.haToken) {
        return { id: "home-assistant", label: "Home Assistant", state: "not_configured" };
      }
      const ha = await timedCheck(() => checkHomeAssistant(cfg));
      return { id: "home-assistant", label: "Home Assistant", ...ha };
    })(),
    (async (): Promise<ServiceCheckResult> => {
      if (!cfg.plaudUrl) return { id: "plaud", label: "Plaud", state: "not_configured" };
      const plaud = await timedCheck(() => checkPlaud(cfg));
      return { id: "plaud", label: "Plaud", ...plaud };
    })(),
    (async (): Promise<ServiceCheckResult> => {
      if (!todoistConfigured(cfg)) return { id: "todoist", label: "Todoist", state: "not_configured" };
      const todoist = await timedCheck(() => checkTodoist(cfg));
      return { id: "todoist", label: "Todoist", ...todoist };
    })(),
  ]);

  results.push(...tail);
  return results;
}

export function peekServiceStatusSnapshot(): ServiceCheckResult[] | null {
  return cache?.results ?? null;
}

export async function getServiceStatusSnapshot(cfg: Config): Promise<ServiceCheckResult[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.results;
  if (inflight) return inflight;
  inflight = runChecks(cfg)
    .then((results) => {
      cache = { at: Date.now(), results };
      return results;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function serviceStatusJson(cfg: Config, results: ServiceCheckResult[]): string {
  const secrets = collectSecrets(cfg);
  const payload = {
    services: results.map((r) => ({
      id: r.id,
      label: r.label,
      state: r.state,
      latencyMs: r.latencyMs,
      downFor: r.downFor,
      version: r.version,
      uptimeSec: r.uptimeSec,
    })),
    checkedAt: new Date().toISOString(),
  };
  return redact(JSON.stringify(payload), secrets);
}

export function aggregateServiceStatusDot(results: ServiceCheckResult[]): "blue" | "orange" | "muted" {
  if (!results.length) return "muted";
  if (results.some((r) => r.state === "down")) return "orange";
  if (results.some((r) => r.state === "unknown")) return "muted";
  return "blue";
}

export function resetServiceStatusCacheForTests(): void {
  cache = null;
  inflight = null;
}
