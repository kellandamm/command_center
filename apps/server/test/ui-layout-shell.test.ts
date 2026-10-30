import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Structural guard: mobile sidebar focus scheduling lives inline in layout.ts boot script.
 * Behavioral coverage is in dashboard.browser.ts (fast mobile sheet close); extracting the
 * IIFE for jsdom/fake-timer tests would duplicate production wiring for little gain.
 */
test("layout shell: cancelFocusWait clears pending sidebar focus timer", async () => {
  const src = await readFile(join(import.meta.dirname, "../src/ui/layout.ts"), "utf8");
  assert.match(
    src,
    /function cancelFocusWait\(\)\{[\s\S]*?if\(focusWait\.timer\)clearTimeout\(focusWait\.timer\)/,
    "cancelFocusWait must clear focusWait.timer (layout.ts mobile sheet focus guard)",
  );
});
