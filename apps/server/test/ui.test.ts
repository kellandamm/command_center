import { test } from "node:test";
import assert from "node:assert/strict";
import { Script, createContext, runInContext } from "node:vm";
import { workspaceScript } from "../src/ui/workspace";
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

test("ui: dashboard renders draggable grid panels and v1 widgets", () => {
  const html = dashboardPage();
  assert.match(html, /class="app-shell"/);
  assert.match(html, /class="sidebar-nav"/);
  assert.match(html, /class="topbar-breadcrumb"/);
  assert.match(html, /id="sidebar-toggle"/);
  assert.match(html, /ui-page-header/);
  assert.match(html, /id="dashboard-grid"/);
  assert.match(html, /id="dashboard-reset-layout"/);
  assert.match(html, /id="panel-tasks"/);
  assert.match(html, /id="panel-attention"/);
  assert.match(html, /id="panel-heatmap"/);
  assert.match(html, /id="panel-focus"/);
  assert.match(html, /PANEL_TITLES/);
  assert.match(html, /class="sr-only"/);
  assert.match(html, /"activity":"\/agent\?view=activity"/);
  assert.match(html, /id="panel-launchpad"/);
  assert.match(html, /data-panel-id="tasks"/);
  assert.match(html, /\/api\/dashboard\/tasks/);
  assert.match(html, /\/api\/dashboard\/attention/);
  assert.match(html, /\/api\/dashboard\/heatmap/);
  assert.match(html, /\/api\/launchpad/);
  assert.match(html, /\/api\/dashboard-layout\/export\.json/);
  assert.match(html, /\/api\/dashboard-layout\/import/);
  assert.match(html, /id="theme-toggle"/);
  assert.doesNotMatch(html, /class="dashboard-overview"/);
});

test("ui: shell breadcrumb and sidebar persistence script", () => {
  const html = dashboardPage();
  assert.match(html, /localStorage\.getItem\("cc-sidebar"\)/);
  assert.match(html, /localStorage\.setItem\(key,next\)/);
  assert.match(html, /sidebarShortcutBlocked/);
  assert.match(html, /page-header-menu\[open\]/);
  assert.match(html, /id="dashboard-import-layout-btn"/);
  assert.match(html, /aria-current="page">Dashboard<\/span>/);
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
  assert.match(html, /class="ui-tabs library-views"/);
  assert.match(html, /class="sr-only" for="source-search"/);
  assert.match(html, /class="ui-field"/);
  assert.match(html, /id="capture-form"/);
  assert.match(html, /Save &amp; summarize/);
  assert.match(html, /set up Chrome capture/);
  assert.doesNotMatch(html, /OPML|feed tree|RSS reader/i);
  assert.doesNotMatch(html, /workspace-tabs/);
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

test("ui: workspace emptyState appends visible title text", () => {
  const ctx = createContext({
    document: {
      createElement(tag: string) {
        const el: {
          tagName: string;
          className: string;
          textContent?: string;
          childNodes: unknown[];
          setAttribute: () => void;
          append: (child: unknown) => void;
        } = {
          tagName: tag,
          className: "",
          childNodes: [],
          setAttribute() {},
          append(child: unknown) {
            el.childNodes.push(child);
          },
        };
        return el;
      },
    },
  });
  runInContext(
    `${workspaceScript}
var box={childNodes:[],replaceChildren:function(){this.childNodes=[]},append:function(n){this.childNodes.push(n)}};
emptyState(box,"No spaces yet","Create one to gather related notes and saved pages in a single place.");
var root=box.childNodes[0];
var title=root&&root.childNodes&&root.childNodes[0];
result={count:box.childNodes.length,text:title&&title.textContent};`,
    ctx,
  );
  const result = (ctx as { result: { count: number; text: string } }).result;
  assert.equal(result.count, 1);
  assert.match(result.text, /No spaces yet/);
});

test("ui: spaces, assistant and capture pages render", () => {
  assert.match(spacesPage(), /id="space-form"/);
  assert.match(spacesPage(), /class="ui-field"/);
  assert.match(spaceDetailPage(), /id="space-ask"/);
  assert.match(assistantPage(), /id="ask-scope"/);
  assert.match(capturePage(), /\/capture-extension\.zip/);
});

test("ui: settings page has schedule and tabs sections", () => {
  const html = settingsPage();
  assert.match(html, /ui-page-header/);
  assert.match(html, /settings-quick-links/);
  assert.match(html, /settings-card settings-tab-panel/);
  assert.match(html, /href="\/settings" class="on"/);
  assert.match(html, /id="tab-schedule"/);
  assert.match(html, /id="tab-views"/);
  assert.match(html, /id="settings-features-list"/);
  assert.match(html, /WHITEBOARD_ENABLED/);
  assert.match(html, /SHARE_LINKS_ENABLED/);
  assert.match(html, /id="tab-tabs"/);
  assert.doesNotMatch(html, /scope-all|fetchInterval|data-pref="(?:news|summaries|aiSecurity|briefing\.news|briefing\.ai)/);
  assert.doesNotMatch(html, /data-pref="dashboard\./);
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
  assert.match(boardPage(), /href="\/agent\?view=board" class="sidebar-sub on"/);
  assert.match(winsPage(), /href="\/agent\?view=wins" class="sidebar-sub on"/);
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
  assert.match(html, /class="ui-tabs"/);
  assert.match(html, /class="ui-dialog" id="knowledge-share-dialog"/);
  assert.match(html, /class="ui-dialog" id="knowledge-switcher"/);
  assert.doesNotMatch(html, /notes-sr-only/);
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
  assert.match(html, /ui-page-header/);
  assert.match(html, /<h1>Bookmarks<\/h1>/);
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
  assert.match(html, /ui-page-header/);
  assert.match(html, /<h1>Calendar<\/h1>/);
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
