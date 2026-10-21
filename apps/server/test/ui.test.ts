import { test } from "node:test";
import assert from "node:assert/strict";
import { aiSecurityPage } from "../src/ui/ai-security-page";
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
  assert.match(html, /href="\/board"/);
  assert.match(html, /href="\/read-later"/);
  assert.match(html, /href="\/calendar"/);
  assert.match(html, /href="\/briefing"/);
  assert.match(html, /href="\/activity"/);
  assert.match(html, /\/api\/read-later/);
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

test("ui: read later saves only what you choose", () => {
  const html = sourcesPage();
  assert.match(html, /href="\/read-later" class="on"/);
  assert.match(html, /id="capture-form"/);
  assert.match(html, /Save &amp; summarize/);
  assert.match(html, /Set up Chrome capture/);
  assert.doesNotMatch(html, /OPML|feed tree|RSS reader/i);
  assert.match(sourcesPage(undefined, true), /href="\/library" class="on"/);
  assert.match(sourceDetailPage(), /id="source-summarize"/);
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
  assert.match(noteToolsPage(undefined, false), /Export Markdown/);
  assert.match(noteToolsPage(undefined, true), /Connections/);
  assert.doesNotMatch(notesPage(), /RSS reader|feed subscriptions/i);
  assert.match(calendarPage(), /id="cal-week-grid"/);
  assert.match(activityPage(), /id="activity-full-list"/);
});
