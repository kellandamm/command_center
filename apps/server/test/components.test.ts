import { test } from "node:test";
import assert from "node:assert/strict";
import {
  badge,
  button,
  emptyState,
  esc,
  errorState,
  field,
  loadingState,
  pageHeader,
  skeleton,
  statCard,
  statGrid,
  table,
  tabs,
} from "../src/ui/components";

test("components: esc escapes HTML", () => {
  assert.equal(esc(`a&b<c>"'`), "a&amp;b&lt;c&gt;&quot;&#39;");
});

test("components: button variants include expected classes", () => {
  assert.match(button({ label: "Save" }), /class="btn"/);
  assert.match(button({ label: "Ghost", variant: "ghost" }), /class="btn ghost"/);
  assert.match(button({ label: "Outline", variant: "outline" }), /btn-outline/);
  assert.match(button({ label: "Danger", variant: "destructive" }), /btn-destructive/);
  assert.match(button({ label: "Small", size: "sm" }), /btn-sm/);
  assert.match(button({ label: "Go", href: "/x" }), /<a class="btn" href="\/x"/);
});

test("components: badge and states escape user text", () => {
  const evil = `<script>"x"`;
  assert.match(badge(evil, "destructive"), /&lt;script&gt;/);
  assert.match(emptyState({ title: evil }), /&lt;script&gt;/);
  assert.match(loadingState(evil), /class="skeleton"/);
  assert.match(errorState(evil), /&lt;script&gt;/);
});

test("components: tabs mark active route", () => {
  const html = tabs(
    [{ id: "/notes", label: "My notes", href: "/notes" }, { id: "/spaces", label: "Spaces", href: "/spaces" }],
    "/notes",
  );
  assert.match(html, /class="ui-tabs"/);
  assert.match(html, /href="\/notes" aria-current="page"/);
});

test("components: pageHeader statCard emptyState skeleton", () => {
  const header = pageHeader({ title: "Dashboard", description: "Hello", actionsHtml: "<button type=button>Go</button>" });
  assert.match(header, /ui-page-header/);
  assert.match(header, /<h1>Dashboard<\/h1>/);
  const grid = statGrid(statCard({ label: "Tasks", value: "3" }));
  assert.match(grid, /class="stat-grid"/);
  assert.match(grid, /class="stat-value tabular-nums"/);
  assert.match(emptyState({ title: "Empty", description: "Try again" }), /class="ui-empty-title"/);
  assert.match(skeleton({ lines: 2 }), /class="skeleton"/);
});

test("components: table and field render structure", () => {
  const tbl = table({ head: ["A", "B"], rows: [["1", "2"]] });
  assert.match(tbl, /class="ui-table"/);
  assert.match(tbl, /<th scope="col">A<\/th>/);
  const fld = field({
    label: "Name",
    id: "n",
    hint: "hint",
    inputHtml: '<input id="n" />',
  });
  assert.match(fld, /class="ui-field"/);
  assert.match(fld, /for="n"/);
});
