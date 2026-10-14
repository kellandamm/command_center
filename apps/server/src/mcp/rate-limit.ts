const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;

export class McpRateLimiter {
  private hits = new Map<string, number[]>();

  allow(clientId: string): boolean {
    const now = Date.now();
    const prev = (this.hits.get(clientId) ?? []).filter((t) => now - t < WINDOW_MS);
    if (prev.length >= MAX_PER_WINDOW) {
      this.hits.set(clientId, prev);
      return false;
    }
    prev.push(now);
    this.hits.set(clientId, prev);
    return true;
  }
}
