const WINDOW_MS = 60_000;

export class ShareLinkRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly maxPerWindow: number) {}

  allow(clientKey: string): boolean {
    const now = Date.now();
    const prev = (this.hits.get(clientKey) ?? []).filter((t) => now - t < WINDOW_MS);
    if (prev.length >= this.maxPerWindow) {
      this.hits.set(clientKey, prev);
      return false;
    }
    prev.push(now);
    this.hits.set(clientKey, prev);
    return true;
  }
}

export function clientIp(headers: { [key: string]: string | string[] | undefined }): string {
  const cf = headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const xff = headers["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return first || "unknown";
}
