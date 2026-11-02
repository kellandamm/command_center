import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { brandSubtitleHtml, esc, page } from "../src/ui/layout";

/** Structural guard only: cancelFocusWait lives inline in layout.ts and is not exported for unit tests. */
test("layout shell: cancelFocusWait clears pending sidebar focus timer", async () => {
  const src = await readFile(join(import.meta.dirname, "../src/ui/layout.ts"), "utf8");
  assert.match(
    src,
    /function cancelFocusWait\(\)\{[\s\S]*?if\(focusWait\.timer\)clearTimeout\(focusWait\.timer\)/,
    "cancelFocusWait must clear focusWait.timer (layout.ts mobile sheet focus guard)",
  );
});

test("layout shell: brand subtitle uses APP_PUBLIC_URL hostname and escapes HTML", () => {
  assert.equal(brandSubtitleHtml("https://stremmy.com"), "<span>stremmy.com</span>");
  assert.equal(brandSubtitleHtml("https://stremmy.com/"), "<span>stremmy.com</span>");
  assert.equal(brandSubtitleHtml(null), "");
  assert.equal(brandSubtitleHtml(undefined), "");
  assert.equal(brandSubtitleHtml(""), "");
  assert.equal(brandSubtitleHtml("not-a-url"), "");
  assert.equal(esc("<host>"), "&lt;host&gt;");
  const html = page({ title: "Test", body: "<p>x</p>", appPublicUrl: "https://command.example.com" });
  assert.match(html, /<strong>Command Center<\/strong><span>command\.example\.com<\/span>/);
  const bare = page({ title: "Test", body: "<p>x</p>", appPublicUrl: null });
  assert.match(bare, /<strong>Command Center<\/strong><\/span>/);
  assert.doesNotMatch(bare, /<strong>Command Center<\/strong><span>/);
});
