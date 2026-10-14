import { test } from "node:test";
import assert from "node:assert/strict";
import { newsPage } from "../src/ui/news-page";
import { dashboardPage, settingsPage } from "../src/ui/pages";

test("ui: dashboard uses shadcn-style shell and panel grid", () => {
  const html = dashboardPage();
  assert.match(html, /class="app-shell"/);
  assert.match(html, /class="sidebar-nav"/);
  assert.match(html, /class="panel-grid"/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /id="panel-weather"/);
});

test("ui: tagged news page has chip bar and compact list", () => {
  const html = newsPage();
  assert.match(html, /href="\/news" class="on"/);
  assert.match(html, /id="news-focus-chips"/);
  assert.match(html, /class="news-compact-list"/);
});

test("ui: settings page wraps form in card", () => {
  const html = settingsPage();
  assert.match(html, /class="card settings-card"/);
  assert.match(html, /href="\/settings" class="on"/);
});
