import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("layout shell: cancelFocusWait clears pending sidebar focus timer", async () => {
  const src = await readFile(join(import.meta.dirname, "../src/ui/layout.ts"), "utf8");
  assert.match(
    src,
    /function cancelFocusWait\(\)\{[\s\S]*?if\(focusWait\.timer\)clearTimeout\(focusWait\.timer\)/,
    "cancelFocusWait must clear focusWait.timer (layout.ts mobile sheet focus guard)",
  );
});
