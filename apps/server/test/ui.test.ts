import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardPage, settingsPage } from "../src/ui/pages";

test("ui: dashboard uses shadcn-style shell and panel grid", () => {
  const html = dashboardPage();
  assert.match(html, /class="app-shell"/);
  assert.match(html, /class="sidebar-nav"/);
  assert.match(html, /class="panel-grid"/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /id="panel-weather"/);
});

test("ui: settings page wraps form in card", () => {
  const html = settingsPage();
  assert.match(html, /class="card settings-card"/);
  assert.match(html, /href="\/settings" class="on"/);
});
