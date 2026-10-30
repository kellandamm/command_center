import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { budgetPage } from "../src/ui/budget-page";
import { DEFAULT_SIDEBAR_TABS, visibleNavTabs } from "../src/nav-tabs";

test("budget ui: import preview omits dateFormat until user changes select", () => {
  const html = budgetPage([], { owner: true, initialView: "import" });
  assert.match(html, /dateFormatTouched/);
  assert.match(html, /importDateFormatFor/);
  assert.match(html, /if\(state\.dateFormatTouched\)/);
  assert.doesNotMatch(html, /fileName=.*&dateFormat=/);
});

test("budget ui: invert checkbox uses saved invert or suggestion", () => {
  const html = budgetPage([], { owner: true, initialView: "import" });
  assert.match(html, /useInvert=!!\(p\.invertSign\|\|p\.suggestInvertSign\)/);
});

test("budget ui: non-owner nav hides Budget tab", () => {
  const nav = visibleNavTabs(DEFAULT_SIDEBAR_TABS, { budget: false });
  assert.ok(!nav.some((t) => t.href === "/budget"));
});

test("budget ui: revert guard — preview must not always send dateFormat", () => {
  const src = readFileSync(join(process.cwd(), "src/ui/budget-page.ts"), "utf8");
  assert.doesNotMatch(src, /encodeURIComponent\(file\.name\)\+"&dateFormat="/);
});
