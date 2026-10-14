import { test } from "node:test";
import assert from "node:assert/strict";
import { aiSecurityPage } from "../src/ui/ai-security-page";
import { dailyBriefingPage } from "../src/ui/daily-briefing-page";
import { newsPage } from "../src/ui/news-page";
import { summariesPage } from "../src/ui/summaries-page";
import { activityPage } from "../src/ui/activity-page";
import { calendarPage } from "../src/ui/calendar-page";
import { hobiePage } from "../src/ui/hobie-page";
import { notesPage } from "../src/ui/notes-page";
import { dashboardPage, settingsPage } from "../src/ui/pages";

test("ui: dashboard shows concise status summaries with links to full pages", () => {
  const html = dashboardPage();
  assert.match(html, /class="app-shell"/);
  assert.match(html, /class="sidebar-nav"/);
  assert.match(html, /class="dashboard-overview"/);
  assert.match(html, /Needs attention/);
  assert.match(html, /Pending Hobie tasks/);
  assert.match(html, /Unread news/);
  assert.match(html, /Next up/);
  assert.match(html, /Today's briefing/);
  assert.match(html, /Recent agent activity/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /href="\/hobie"/);
  assert.match(html, /href="\/news"/);
  assert.match(html, /href="\/calendar"/);
  assert.match(html, /href="\/briefing"/);
  assert.match(html, /href="\/activity"/);
  assert.match(html, /\/api\/feeds/);
  assert.match(html, /\/api\/calendar\?horizonDays=7/);
  assert.match(html, /\/api\/daily-briefing/);
  assert.doesNotMatch(html, /dashboard-grid|dashboard-reset-layout|data-panel-id=/);
});

test("ui: ai security page has archive and empty state", () => {
  const html = aiSecurityPage();
  assert.match(html, /href="\/ai-security" class="on"/);
  assert.match(html, /id="as-empty"/);
  assert.match(html, /id="as-empty-title">No editions yet/);
  assert.match(html, /weekly AI Security roundup will appear here when the first edition is published/);
  assert.match(html, /Couldn't load roundups/);
  assert.doesNotMatch(html, /Publish the first edition|AI_SECURITY_TOKEN|Authorization: Bearer/);
  assert.match(html, /id="as-archive"/);
});

test("ui: daily briefing page has source sections and nav link", () => {
  const html = dailyBriefingPage();
  assert.match(html, /href="\/briefing" class="on"/);
  assert.match(html, /class="morning-briefing"/);
  assert.match(html, /class="morning-masthead"/);
  assert.match(html, /The Morning Briefing/);
  assert.match(html, /Stories worth your time/);
  assert.match(html, /class="briefing-rail"/);
  assert.match(html, /The almanac/);
  assert.match(html, /id="db-news"/);
  assert.match(html, /id="db-ai"/);
  assert.match(html, /id="db-calendar"/);
  assert.match(html, /id="db-weather"/);
  assert.match(html, /id="db-todoist"/);
  assert.match(html, /id="db-github"/);
  assert.match(html, /id="db-refresh"/);
  assert.match(html, /class="briefing-grid"/);
  assert.match(html, /id="db-error"/);
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

test("ui: settings page has schedule and tabs sections", () => {
  const html = settingsPage();
  assert.match(html, /settings-card settings-tab-panel/);
  assert.match(html, /href="\/settings" class="on"/);
  assert.match(html, /id="tab-schedule"/);
  assert.match(html, /id="tab-views"/);
  assert.match(html, /id="tab-tabs"/);
  assert.match(html, /id="scope-all"/);
  assert.match(html, /data-pref="dashboard.hobie"/);
  assert.match(html, /data-pref="briefing.github"/);
  assert.match(html, /data-pref="calendar.weekStartsOn"/);
  assert.match(html, /data-pref="activity.limit"/);
  assert.match(html, /id="views-save"/);
});

test("ui: full sidebar pages render", () => {
  assert.match(hobiePage(), /href="\/hobie" class="on"/);
  assert.match(notesPage(), /id="notes-editor-full"/);
  assert.match(calendarPage(), /id="cal-week-grid"/);
  assert.match(activityPage(), /id="activity-full-list"/);
});
