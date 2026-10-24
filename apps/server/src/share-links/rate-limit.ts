const WINDOW_MS = 60_000;
const DEFAULT_MAX_TRACKED_KEYS = 4096;

export class ShareLinkRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly maxPerWindow: number,
    private readonly maxTrackedKeys = DEFAULT_MAX_TRACKED_KEYS,
  ) {}

  allow(clientKey: string): boolean {
    const now = Date.now();
    this.prune(now);
    const prev = this.hits.get(clientKey) ?? [];
    const active = prev.filter((t) => now - t < WINDOW_MS);
    if (active.length >= this.maxPerWindow) {
      this.hits.set(clientKey, active);
      return false;
    }
    if (!this.hits.has(clientKey) && this.hits.size >= this.maxTrackedKeys) {
      return false;
    }
    active.push(now);
    this.hits.set(clientKey, active);
    return true;
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) {
      const active = times.filter((t) => now - t < WINDOW_MS);
      if (!active.length) this.hits.delete(key);
      else this.hits.set(key, active);
    }
  }
}

export function clientIp(headers: { [key: string]: string | string[] | undefined }): string {
  const cf = headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const xff = headers["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return first || "unknown";
}
