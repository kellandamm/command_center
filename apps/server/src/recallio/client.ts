import type { Config } from "../config";
import { safeFetch } from "../ssrf";

export interface RecallioHit {
  id: string | null;
  title: string;
  snippet: string;
  url: string | null;
  score: number | null;
}

export interface RecallioSearchOutcome {
  configured: boolean;
  ok: boolean;
  error: string | null;
  results: RecallioHit[];
}

const blank = (v: string | undefined | null) => (v && v.trim() ? v.trim() : null);

export function recallioConfigured(cfg: Config): boolean {
  return Boolean(blank(cfg.recallioUrl));
}

export function recallioAccessHeaders(cfg: Config): Record<string, string> {
  const id = blank(cfg.cfAccessClientId);
  const secret = blank(cfg.cfAccessClientSecret);
  if (!id || !secret) return {};
  return { "cf-access-client-id": id, "cf-access-client-secret": secret };
}

export function recallioSearchUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/search`;
}

/** Normalize Recallio / compatible JSON into dashboard hits. */
export function parseRecallioSearchBody(raw: string, contentType: string): RecallioHit[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new Error("Recallio returned non-JSON");
  }
  const list = extractResultList(data);
  return list.map(normalizeHit).filter((h) => h.title || h.snippet);
}

function extractResultList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const key of ["results", "items", "memories", "data"]) {
      if (Array.isArray(o[key])) return o[key] as unknown[];
    }
  }
  return [];
}

function normalizeHit(row: unknown): RecallioHit {
  if (typeof row === "string") {
    return { id: null, title: row.slice(0, 120), snippet: row, url: null, score: null };
  }
  if (!row || typeof row !== "object") {
    return { id: null, title: "", snippet: "", url: null, score: null };
  }
  const r = row as Record<string, unknown>;
  const content = pickString(r, ["content", "snippet", "summary", "text", "body"]);
  const title = pickString(r, ["title", "name"]) ?? (content ? content.slice(0, 120) : "Memory");
  const url = pickString(r, ["url", "link", "href"]);
  const id = pickString(r, ["id", "memoryId"]);
  const score = pickNumber(r, ["score", "similarityScore", "similarity"]);
  return { id, title, snippet: content ?? title, url, score };
}

function pickString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickNumber(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

export async function searchRecallio(cfg: Config, query: string, limit = 10): Promise<RecallioSearchOutcome> {
  const base = blank(cfg.recallioUrl);
  if (!base) {
    return { configured: false, ok: false, error: "Recallio not configured — set RECALLIO_URL on the server.", results: [] };
  }
  const q = query.trim();
  if (!q) {
    return { configured: true, ok: true, error: null, results: [] };
  }
  if (q.length > 500) {
    return { configured: true, ok: false, error: "Query is too long (max 500 characters).", results: [] };
  }
  const url = recallioSearchUrl(base);
  try {
    const res = await safeFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...recallioAccessHeaders(cfg) },
      body: JSON.stringify({ q, limit }),
      timeoutMs: 15_000,
      maxBytes: 1_500_000,
    });
    if (res.status < 200 || res.status >= 300) {
      const hint = res.status === 401 || res.status === 403 ? " Check CF Access service token or Recallio credentials." : "";
      return {
        configured: true,
        ok: false,
        error: `Recallio search failed (HTTP ${res.status}).${hint}`,
        results: [],
      };
    }
    const results = parseRecallioSearchBody(res.body, res.contentType);
    return { configured: true, ok: true, error: null, results };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Recallio request failed";
    return { configured: true, ok: false, error: msg, results: [] };
  }
}
