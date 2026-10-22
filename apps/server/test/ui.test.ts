import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { dailyBriefingPage } from "../src/ui/daily-briefing-page";
import { sourceDetailPage, sourcesPage } from "../src/ui/sources-page";
import { spaceDetailPage, spacesPage } from "../src/ui/spaces-page";
import { assistantPage } from "../src/ui/assistant-page";
import { capturePage } from "../src/ui/capture-page";
import { activityPage } from "../src/ui/activity-page";
import { calendarPage } from "../src/ui/calendar-page";
import { boardPage } from "../src/ui/board-page";
import { winsPage } from "../src/ui/wins-page";
import { noteToolsPage, notesPage } from "../src/ui/notes-page";
import { bookmarksPage } from "../src/ui/bookmarks-page";
import { dashboardPage, settingsPage } from "../src/ui/pages";

test("ui: dashboard shows concise status summaries with links to full pages", () => {
  const html = dashboardPage();
  assert.match(html, /class="app-shell"/);
  assert.match(html, /class="sidebar-nav"/);
  assert.match(html, /class="dashboard-overview"/);
  assert.match(html, /Needs attention/);
  assert.match(html, /Hobie board/);
  assert.match(html, /Read later/);
  assert.match(html, /Next up/);
  assert.match(html, /Today's briefing/);
  assert.match(html, /Recent agent activity/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /href="\/agent\?view=board"/);
  assert.match(html, /href="\/library\?view=inbox"/);
  assert.match(html, /\/api\/read-later/);
  assert.doesNotMatch(html, /href="\/(?:news|summaries|ai-security)"/);
  assert.match(html, /href="\/calendar"/);
  assert.match(html, /href="\/briefing"/);
  assert.match(html, /href="\/agent\?view=activity"/);
  assert.doesNotMatch(html, /\/api\/(?:feeds|news|rss|summaries|ai-security)/);
  assert.match(html, /\/api\/calendar\?horizonDays=7/);
  assert.match(html, /\/api\/daily-briefing/);
  assert.doesNotMatch(html, /dashboard-grid|dashboard-reset-layout|data-panel-id=/);
});

test("ui: daily briefing page has source sections and nav link", () => {
  const html = dailyBriefingPage();
  assert.match(html, /href="\/briefing" class="on"/);
  assert.match(html, /class="morning-briefing"/);
  assert.match(html, /class="morning-masthead"/);
  assert.match(html, /The Morning Briefing/);
  assert.doesNotMatch(html, /Stories worth your time|db-news|db-ai/);
  assert.match(html, /class="briefing-rail"/);
  assert.match(html, /The almanac/);
  assert.match(html, /id="db-calendar"/);
  assert.match(html, /id="db-weather"/);
  assert.match(html, /id="db-topics"/);
  assert.match(html, /Manage topics/);
  assert.doesNotMatch(html, /db-todoist|db-github|db-board|Blocked on me|Yesterday's wins/);
  assert.match(html, /id="db-refresh"/);
  assert.match(html, /class="briefing-grid"/);
  assert.match(html, /id="db-error"/);
});

test("ui: Library combines saved links, Read later, and summaries", () => {
  const html = sourcesPage();
  assert.match(html, /href="\/library" class="on"/);
  assert.match(html, /id="capture-form"/);
  assert.match(html, /Save &amp; summarize/);
  assert.match(html, /set up Chrome capture/);
  assert.doesNotMatch(html, /OPML|feed tree|RSS reader/i);
  for (const view of ["all", "inbox", "summarized", "archive"]) {
    assert.match(html, new RegExp(`data-library-view="${view}"`));
  }
  for (const id of ["source-space-filter", "source-tag-filter", "source-sort", "source-compact-view", "source-list-view", "source-card-view", "folder-list", "tag-list", "folder-form", "capture-space", "capture-tags", "source-next", "source-prev"]) {
    assert.ok(html.includes(`id="${id}"`));
  }
  assert.equal((html.match(/href="\/library" class="on"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /href="\/read-later"/);
  assert.match(sourceDetailPage(), /id="source-summarize"/);
  assert.match(html, /<h1>Read Later<\/h1>/);
  assert.match(html, /pageSize=50/);
});

test("ui: spaces, assistant and capture pages render", () => {
  assert.match(spacesPage(), /id="space-form"/);
  assert.match(spaceDetailPage(), /id="space-ask"/);
  assert.match(assistantPage(), /id="ask-scope"/);
  assert.match(capturePage(), /\/capture-extension\.zip/);
});

test("ui: settings page has schedule and tabs sections", () => {
  const html = settingsPage();
  assert.match(html, /settings-card settings-tab-panel/);
  assert.match(html, /href="\/settings" class="on"/);
  assert.match(html, /id="tab-schedule"/);
  assert.match(html, /id="tab-views"/);
  assert.match(html, /id="tab-tabs"/);
  assert.doesNotMatch(html, /scope-all|fetchInterval|data-pref="(?:news|summaries|aiSecurity|briefing\.news|briefing\.ai)/);
  assert.match(html, /data-pref="dashboard.hobie"/);
  assert.match(html, /data-pref="briefing.topics"/);
  assert.match(html, /data-pref="calendar.weekStartsOn"/);
  assert.match(html, /data-pref="activity.limit"/);
  assert.match(html, /id="views-save"/);
});

test("ui: retained dashboard, settings and briefing scripts parse without retired integrations", () => {
  for (const html of [dashboardPage(), settingsPage(), dailyBriefingPage()]) {
    assert.doesNotMatch(html, /\/api\/(?:feeds|rss|news|summaries|ai-security|briefing\/generate)/);
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => new Script(match[1]!));
    }
  }
});

test("ui: full sidebar pages render", () => {
  assert.match(boardPage(), /href="\/agent" class="on"/);
  assert.match(boardPage(), /href="\/agent\?view=board" aria-current="page"/);
  assert.match(winsPage(), /href="\/agent\?view=wins" aria-current="page"/);
  assert.match(notesPage(), /id="knowledge-note-list"/);
  assert.match(noteToolsPage(undefined, false), /Export Markdown/);
  assert.match(noteToolsPage(undefined, true), /Connections/);
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

test("ui: Calendar has mini-month, agenda, native editing, read-only subscriptions, and day/week/month views", () => {
  const html = calendarPage();
  for (const id of ["cal-mini", "cal-agenda", "cal-search", "cal-sources", "cal-event-dialog", "cal-today", "cal-refresh"]) {
    assert.ok(html.includes(`id="${id}"`));
  }
  for (const mode of ["day", "week", "month"]) assert.ok(html.includes(`data-cal-view="${mode}"`));
  assert.match(html, /Subscribed event · read-only/);
  assert.match(html, /href="\/calendar\/event">New event/);
  assert.match(html, /href="\/settings\/calendars">Calendar settings/);
  assert.match(html, /id="cal-event-edit"/);
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    assert.doesNotThrow(() => new Script(match[1]!));
  }
});
