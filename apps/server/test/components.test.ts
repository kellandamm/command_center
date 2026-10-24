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
  assert.match(loadingState(evil), /&lt;script&gt;/);
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
