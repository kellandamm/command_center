/** In-memory nonce dedupe for queue HMAC (±QUEUE_HMAC_WINDOW_SEC). Cleared on process restart. */
export class QueueNonceStore {
  private seen = new Map<string, number>();

  constructor(private ttlMs: number) {}

  /** Returns false if nonce was already used within the TTL window. */
  remember(nonce: string, nowMs = Date.now()): boolean {
    this.prune(nowMs);
    if (!nonce || nonce.length > 128) return false;
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, nowMs + this.ttlMs);
    return true;
  }

  private prune(nowMs: number): void {
    for (const [nonce, expires] of this.seen) {
      if (expires <= nowMs) this.seen.delete(nonce);
    }
  }
}
