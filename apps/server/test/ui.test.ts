import { test } from "node:test";
import assert from "node:assert/strict";
import { aiSecurityPage } from "../src/ui/ai-security-page";
import { dailyBriefingPage } from "../src/ui/daily-briefing-page";
import { newsPage } from "../src/ui/news-page";
import { summariesPage } from "../src/ui/summaries-page";
import { dashboardPage, settingsPage } from "../src/ui/pages";

test("ui: dashboard uses shadcn-style shell and draggable grid", () => {
  const html = dashboardPage();
  assert.match(html, /class="app-shell"/);
  assert.match(html, /class="sidebar-nav"/);
  assert.match(html, /id="dashboard-grid"/);
  assert.match(html, /id="dashboard-reset-layout"/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /id="panel-weather"/);
  assert.match(html, /data-panel-id="feeds"/);
  assert.match(html, /data-panel-id="tagged-news"/);
  assert.match(html, /data-panel-id="daily-briefing"/);
  assert.match(html, /data-panel-id="ai-security"/);
  assert.match(html, /data-panel-id="activity"/);
  assert.match(html, /data-panel-id="hobie"/);
});

test("ui: ai security page has archive and empty state", () => {
  const html = aiSecurityPage();
  assert.match(html, /href="\/ai-security" class="on"/);
  assert.match(html, /id="as-empty"/);
  assert.match(html, /id="as-archive"/);
});

test("ui: daily briefing page has source sections and nav link", () => {
  const html = dailyBriefingPage();
  assert.match(html, /href="\/briefing" class="on"/);
  assert.match(html, /id="db-todoist"/);
  assert.match(html, /id="db-refresh"/);
  assert.match(html, /class="briefing-grid"/);
});

test("ui: news reader has feed tree and article list", () => {
  const html = newsPage();
  assert.match(html, /href="\/news" class="on"/);
  assert.match(html, /id="news-focus-chips"/);
  assert.match(html, /id="rss-tree"/);
  assert.match(html, /id="rss-articles"/);
  assert.match(html, /id="rss-read-pane"/);
});

test("ui: summaries page has search and auto settings", () => {
  const html = summariesPage();
  assert.match(html, /href="\/summaries" class="on"/);
  assert.match(html, /id="sum-list"/);
  assert.match(html, /id="sum-auto-star"/);
});

test("ui: settings page wraps form in card", () => {
  const html = settingsPage();
  assert.match(html, /class="card settings-card"/);
  assert.match(html, /href="\/settings" class="on"/);
});
