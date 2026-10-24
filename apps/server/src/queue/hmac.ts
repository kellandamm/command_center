import { createHmac, timingSafeEqual } from "node:crypto";

export const QUEUE_HMAC_WINDOW_SEC = 300;

export function queueSignPayload(ts: number | string, nonce: string, rawBody: string): string {
  return `${ts}|${nonce}|${rawBody}`;
}

export function queueHmacSign(key: string, ts: number | string, nonce: string, rawBody: string): string {
  return createHmac("sha256", key).update(queueSignPayload(ts, nonce, rawBody), "utf8").digest("hex");
}

export function queueHmacVerify(key: string, ts: number | string, nonce: string, rawBody: string, presentedHex: string): boolean {
  const expected = queueHmacSign(key, ts, nonce, rawBody);
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(presentedHex.trim(), "hex");
    if (a.length !== b.length || a.length !== 32) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
