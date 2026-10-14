import { safeFetch } from "../ssrf";

const GITHUB_ACCEPT = "application/vnd.github+json";

export interface GithubJsonResult<T> {
  ok: boolean;
  status: number;
  data: T;
  rateLimitRemaining: string | null;
  error: string | null;
}

export async function githubGetJson<T>(
  url: string,
  extraHeaders?: Record<string, string>,
): Promise<GithubJsonResult<T>> {
  const res = await safeFetch(url, {
    headers: {
      accept: GITHUB_ACCEPT,
      "x-github-api-version": "2022-11-28",
      ...extraHeaders,
    },
    maxBytes: 1_500_000,
    timeoutMs: 25_000,
  });
  let parsed: T;
  try {
    parsed = JSON.parse(res.body || "null") as T;
  } catch {
    return {
      ok: false,
      status: res.status,
      data: {} as T,
      rateLimitRemaining: null,
      error: "GitHub returned non-JSON response.",
    };
  }
  if (res.status >= 200 && res.status < 300) {
    return { ok: true, status: res.status, data: parsed, rateLimitRemaining: null, error: null };
  }
  const message =
    typeof parsed === "object" && parsed && "message" in parsed && typeof (parsed as { message: unknown }).message === "string"
      ? (parsed as { message: string }).message
      : `HTTP ${res.status}`;
  return { ok: false, status: res.status, data: parsed, rateLimitRemaining: null, error: message };
}
