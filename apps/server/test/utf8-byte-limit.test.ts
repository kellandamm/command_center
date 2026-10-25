import test from "node:test";
import assert from "node:assert/strict";
import {
  EXCERPT_MAX_UTF8_BYTES,
  extensionTruncateUtf8ToBytes,
  truncateUtf8ToBytes,
} from "../src/utf8-byte-limit";

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function assertValidUtf8(value: string) {
  assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(value)), value);
  assert.doesNotMatch(value, /\uFFFD/);
}

function runTruncateCases(truncate: (value: string, max: number, ellipsis?: string) => string) {
  const ascii = "a".repeat(EXCERPT_MAX_UTF8_BYTES - 1);
  assert.equal(truncate(ascii, EXCERPT_MAX_UTF8_BYTES), ascii);
  const at = "a".repeat(EXCERPT_MAX_UTF8_BYTES);
  assert.equal(truncate(at, EXCERPT_MAX_UTF8_BYTES), at);
  const over = "a".repeat(EXCERPT_MAX_UTF8_BYTES + 50);
  const trimmed = truncate(over, EXCERPT_MAX_UTF8_BYTES, "…");
  assert.ok(utf8Bytes(trimmed) <= EXCERPT_MAX_UTF8_BYTES);
  assert.ok(trimmed.endsWith("…"));
  assertValidUtf8(trimmed);

  const cjk = "漢".repeat(8_000);
  assert.ok(utf8Bytes(cjk) > EXCERPT_MAX_UTF8_BYTES);
  const cjkTrimmed = truncate(cjk, EXCERPT_MAX_UTF8_BYTES, "…");
  assert.ok(utf8Bytes(cjkTrimmed) <= EXCERPT_MAX_UTF8_BYTES);
  assertValidUtf8(cjkTrimmed);

  const accented = "café".repeat(5_000);
  const accentedTrimmed = truncate(accented, EXCERPT_MAX_UTF8_BYTES, "…");
  assert.ok(utf8Bytes(accentedTrimmed) <= EXCERPT_MAX_UTF8_BYTES);
  assertValidUtf8(accentedTrimmed);

  const emoji = "🎉".repeat(6_000);
  const emojiTrimmed = truncate(emoji, EXCERPT_MAX_UTF8_BYTES, "…");
  assert.ok(utf8Bytes(emojiTrimmed) <= EXCERPT_MAX_UTF8_BYTES);
  assertValidUtf8(emojiTrimmed);

  const mixed = `${"e".repeat(EXCERPT_MAX_UTF8_BYTES - 5)}漢🎉`;
  const mixedTrimmed = truncate(mixed, EXCERPT_MAX_UTF8_BYTES, "…");
  assert.ok(utf8Bytes(mixedTrimmed) <= EXCERPT_MAX_UTF8_BYTES);
  assertValidUtf8(mixedTrimmed);

  const loneHigh = "\uD800";
  const loneTrimmed = truncate(`${"x".repeat(EXCERPT_MAX_UTF8_BYTES)}${loneHigh}`, EXCERPT_MAX_UTF8_BYTES, "…");
  assert.ok(utf8Bytes(loneTrimmed) <= EXCERPT_MAX_UTF8_BYTES);
  assertValidUtf8(loneTrimmed);
}

test("truncateUtf8ToBytes: ASCII and multibyte boundaries", () => {
  runTruncateCases(truncateUtf8ToBytes);
});

test("extension truncateUtf8ToBytes source matches server helper", () => {
  runTruncateCases(extensionTruncateUtf8ToBytes);
});
