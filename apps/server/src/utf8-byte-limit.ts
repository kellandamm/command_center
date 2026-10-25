/** Max UTF-8 byte length for saved article excerpts (capture + library). */
export const EXCERPT_MAX_UTF8_BYTES = 20_000;

const DEFAULT_ELLIPSIS = "…";

/**
 * Truncate `value` to at most `maxBytes` UTF-8 bytes without splitting a code point.
 * Appends `ellipsis` only when it still fits within `maxBytes`.
 */
export function truncateUtf8ToBytes(
  value: string,
  maxBytes: number,
  ellipsis: string = DEFAULT_ELLIPSIS,
): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  if (bytes.length <= maxBytes) return value;

  let budget = maxBytes;
  const ellipsisBytes = ellipsis ? encoder.encode(ellipsis) : new Uint8Array(0);
  if (ellipsis && ellipsisBytes.length < maxBytes) budget = maxBytes - ellipsisBytes.length;
  else if (ellipsis) budget = 0;

  let end = Math.min(budget, bytes.length);
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;

  const head = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
  if (!ellipsis || ellipsisBytes.length >= maxBytes) return head;
  const withEllipsis = head + ellipsis;
  return encoder.encode(withEllipsis).length <= maxBytes ? withEllipsis : head;
}

/** Inlined into the capture extension popup (no imports in the unpacked extension). */
export const truncateUtf8ToBytesExtensionSource = `function truncateUtf8ToBytes(value, maxBytes, ellipsis) {
  var encoder = new TextEncoder();
  var bytes = encoder.encode(value);
  if (bytes.length <= maxBytes) return value;
  var budget = maxBytes;
  var ellipsisBytes = ellipsis ? encoder.encode(ellipsis) : new Uint8Array(0);
  if (ellipsis && ellipsisBytes.length < maxBytes) budget = maxBytes - ellipsisBytes.length;
  else if (ellipsis) budget = 0;
  var end = Math.min(budget, bytes.length);
  while (end > 0 && (bytes[end] & 192) === 128) end -= 1;
  var head = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
  if (!ellipsis || ellipsisBytes.length >= maxBytes) return head;
  var withEllipsis = head + ellipsis;
  return encoder.encode(withEllipsis).length <= maxBytes ? withEllipsis : head;
}`;

export function extensionTruncateUtf8ToBytes(value: string, maxBytes: number, ellipsis?: string): string {
  const fn = new Function(`${truncateUtf8ToBytesExtensionSource}; return truncateUtf8ToBytes;`)() as (
    v: string, m: number, e?: string,
  ) => string;
  return fn(value, maxBytes, ellipsis);
}
