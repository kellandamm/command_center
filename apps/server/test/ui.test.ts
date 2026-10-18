import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { aiSecurityPage } from "../src/ui/ai-security-page";
import { dailyBriefingPage } from "../src/ui/daily-briefing-page";
import { newsPage } from "../src/ui/news-page";
import { summariesPage } from "../src/ui/summaries-page";
import { activityPage } from "../src/ui/activity-page";
import { calendarPage } from "../src/ui/calendar-page";
import { boardPage } from "../src/ui/board-page";
import { winsPage } from "../src/ui/wins-page";
import { notesPage } from "../src/ui/notes-page";
import { bookmarksPage } from "../src/ui/bookmarks-page";
import { dashboardPage, settingsPage } from "../src/ui/pages";

test("ui: dashboard shows concise status summaries with links to full pages", () => {
  const html = dashboardPage();
  assert.match(html, /class="app-shell"/);
  assert.match(html, /class="sidebar-nav"/);
  assert.match(html, /class="dashboard-overview"/);
  assert.match(html, /Needs attention/);
  assert.match(html, /Hobie board/);
  assert.match(html, /Unread news/);
  assert.match(html, /Next up/);
  assert.match(html, /Today's briefing/);
  assert.match(html, /Recent agent activity/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /href="\/board"/);
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
  assert.match(html, /Blocked on me/);
  assert.match(html, /Yesterday's wins/);
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
  assert.match(html, /Saved for later/);
  assert.match(html, /id="rss-read-toggle"/);
  assert.match(html, /data-article-action="save"/);
  assert.match(html, /data-article-action="read"/);
  assert.match(html, /if\(sc==="saved"\)document\.getElementById\("rss-unread-only"\)\.checked=false/);
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
  assert.match(boardPage(), /href="\/board" class="on"/);
  assert.match(winsPage(), /href="\/wins" class="on"/);
  assert.match(notesPage(), /id="knowledge-note-list"/);
  assert.match(notesPage(), /Export Markdown/);
  assert.match(notesPage(), /Note link graph/);
  assert.doesNotMatch(notesPage(), /RSS reader|feed subscriptions/i);
  assert.match(calendarPage(), /id="cal-week-grid"/);
  assert.match(activityPage(), /id="activity-full-list"/);
});

test("ui: Notes centers writing with preview, formatting, focus, and collapsed properties", () => {
  const html = notesPage();
  assert.match(html, /<h1>Notes<\/h1>/);
  for (const id of ["knowledge-preview", "knowledge-formatting", "knowledge-focus", "knowledge-word-count"]) {
    assert.ok(html.includes(`id="${id}"`));
  }
  for (const mode of ["source", "split", "preview"]) {
    assert.ok(html.includes(`data-note-mode="${mode}"`));
  }
  assert.match(html, /<details class="notes-properties">/);
  assert.match(html, /Changes save automatically/);
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    assert.doesNotThrow(() => new Script(match[1]!));
  }
});

test("ui: Bookmarks is a separate grouped launchpad with search, import and layout controls", () => {
  const html = bookmarksPage();
  assert.match(html, /href="\/bookmarks" class="on"/);
  for (const id of ["bookmark-groups", "bookmark-search", "bookmark-import", "bookmark-density", "bookmark-columns", "bookmark-dialog"]) {
    assert.ok(html.includes(`id="${id}"`));
  }
  assert.match(html, /Download backup/);
  assert.doesNotMatch(html, /favicon|google\.com\/s2/);
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    assert.doesNotThrow(() => new Script(match[1]!));
  }
});
