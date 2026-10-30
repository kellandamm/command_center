import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { escapeHtmlText } from "../src/ui/budget-escape";
import { budgetPage } from "../src/ui/budget-page";
import { DEFAULT_SIDEBAR_TABS, visibleNavTabs } from "../src/nav-tabs";

const XSS = '<img src=x onerror=alert(1)>';

test("budget ui: escapeHtmlText neutralizes HTML", () => {
  assert.equal(escapeHtmlText(XSS), "&lt;img src=x onerror=alert(1)&gt;");
  assert.doesNotMatch(escapeHtmlText(XSS), /[<>]/);
});

test("budget ui: page script renders payees with textContent not innerHTML", () => {
  const html = budgetPage([], { owner: true, initialView: "import" });
  assert.match(html, /textCell\(tr,r\.payee/);
  assert.match(html, /td\.textContent=/);
  assert.doesNotMatch(html, /innerHTML\s*=\s*[^;]*payee/i);
  assert.doesNotMatch(html, /innerHTML\s*=\s*[^;]*\.name/i);
  assert.match(html, /useInvert=!!\(p\.invertSign\|\|p\.suggestInvertSign\)/);
});

test("budget ui: non-owner nav hides Budget tab", () => {
  const nav = visibleNavTabs(DEFAULT_SIDEBAR_TABS, { budget: false });
  assert.ok(!nav.some((t) => t.href === "/budget"));
});

test("budget ui: revert guard — broken XSS escape must fail", () => {
  const src = readFileSync(join(process.cwd(), "src/ui/budget-page.ts"), "utf8");
  assert.doesNotMatch(src, /replace\([^)]*\\u003c/);
  assert.doesNotMatch(src, /innerHTML\s*=\s*escHtml\([^)]*payee/i);
});
