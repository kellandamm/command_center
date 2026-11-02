import type { Config } from "../config";
import { todoistConfigured } from "../config";
import { safeFetch } from "../ssrf";

export type ServiceState = "up" | "down" | "unknown" | "not_configured";

export interface ServiceCheckResult {
  id: string;
  label: string;
  state: ServiceState;
  latencyMs?: number;
  downFor?: string;
}

const CACHE_MS = 60_000;
let cache: { at: number; results: ServiceCheckResult[]; secrets: string[] } | null = null;

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s || s.length < 4) continue;
    out = out.split(s).join("[redacted]");
  }
  return out;
}

async function timedCheck(fn: () => Promise<{ ok: boolean; detail?: string }>): Promise<{ state: ServiceState; latencyMs?: number; downFor?: string }> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise<{ ok: false; detail: string }>((resolve) => setTimeout(() => resolve({ ok: false, detail: "timeout" }), 5000)),
    ]);
    const latencyMs = Date.now() - start;
    if (result.ok) return { state: "up", latencyMs };
    return { state: result.detail === "timeout" ? "unknown" : "down", latencyMs, downFor: result.detail === "timeout" ? undefined : "down" };
  } catch {
    return { state: "unknown", latencyMs: Date.now() - start };
  }
}

function collectSecrets(cfg: Config): string[] {
  const secrets = [
    cfg.adminToken,
    cfg.todoistApiToken,
    cfg.haToken,
    cfg.plaudUrl,
    cfg.cfAccessClientSecret,
  ].filter((s): s is string => !!s && s.length >= 4);
  return secrets;
}

async function checkStremmy(cfg: Config): Promise<{ ok: boolean }> {
  const base = cfg.appPublicUrl ?? `http://127.0.0.1:${cfg.port}`;
  const url = `${base.replace(/\/+$/, "")}/healthz`;
  const { status, body } = await safeFetch(url, { timeoutMs: 4000, maxBytes: 4096 });
  if (status < 200 || status >= 300) return { ok: false };
  void body;
  return { ok: true };
}

async function checkTodoist(cfg: Config): Promise<{ ok: boolean }> {
  if (!todoistConfigured(cfg)) return { ok: false };
  const { status } = await safeFetch("https://api.todoist.com/api/v1/projects", {
    timeoutMs: 4000,
    maxBytes: 4096,
    headers: { authorization: `Bearer ${cfg.todoistApiToken}` },
  });
  return { ok: status >= 200 && status < 300 };
}

async function checkPlaud(cfg: Config): Promise<{ ok: boolean }> {
  if (!cfg.plaudUrl) return { ok: false };
  const { status } = await safeFetch(cfg.plaudUrl, { timeoutMs: 4000, maxBytes: 4096 });
  return { ok: status >= 200 && status < 500 };
}

async function checkHomeAssistant(cfg: Config): Promise<{ ok: boolean }> {
  if (!cfg.haUrl || !cfg.haToken) return { ok: false };
  const url = `${cfg.haUrl.replace(/\/+$/, "")}/api/`;
  const { status } = await safeFetch(url, {
    timeoutMs: 4000,
    maxBytes: 4096,
    headers: { authorization: `Bearer ${cfg.haToken}` },
  });
  return { ok: status >= 200 && status < 300 };
}

export async function getServiceStatusSnapshot(cfg: Config): Promise<ServiceCheckResult[]> {
  const secrets = collectSecrets(cfg);
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.results;

  const results: ServiceCheckResult[] = [];

  if (!cfg.appPublicUrl && cfg.host === "127.0.0.1") {
    const stremmy = await timedCheck(() => checkStremmy(cfg));
    results.push({ id: "stremmy", label: "stremmy.com", ...stremmy });
  } else {
    const stremmy = await timedCheck(() => checkStremmy(cfg));
    results.push({ id: "stremmy", label: "stremmy.com", ...stremmy });
  }

  if (!cfg.haUrl || !cfg.haToken) {
    results.push({ id: "home-assistant", label: "Home Assistant", state: "not_configured" });
  } else {
    const ha = await timedCheck(() => checkHomeAssistant(cfg));
    results.push({ id: "home-assistant", label: "Home Assistant", ...ha });
  }

  if (!cfg.plaudUrl) {
    results.push({ id: "plaud", label: "Plaud", state: "not_configured" });
  } else {
    const plaud = await timedCheck(() => checkPlaud(cfg));
    results.push({ id: "plaud", label: "Plaud", ...plaud });
  }

  if (!todoistConfigured(cfg)) {
    results.push({ id: "todoist", label: "Todoist", state: "not_configured" });
  } else {
    const todoist = await timedCheck(() => checkTodoist(cfg));
    results.push({ id: "todoist", label: "Todoist", ...todoist });
  }

  cache = { at: now, results, secrets };
  return results;
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
    })),
    checkedAt: new Date().toISOString(),
  };
  return redact(JSON.stringify(payload), secrets);
}

export function resetServiceStatusCacheForTests(): void {
  cache = null;
}
