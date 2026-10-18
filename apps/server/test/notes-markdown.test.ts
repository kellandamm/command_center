import { test } from "node:test";
import assert from "node:assert/strict";
import { renderNoteMarkdown } from "../src/notes/markdown";

test("notes preview renders Markdown headings, formatting, lists, tables, and code", () => {
  const html = renderNoteMarkdown([
    "# Heading", "", "**Bold** and _italic_ and ~~done~~", "",
    "> A quote", "", "- One", "- Two", "",
    "| Name | Status |", "| --- | --- |", "| Notes | Ready |", "",
    "```ts", "const x = '<script>'; ", "```",
  ].join("\n"));
  for (const fragment of ["<h1>Heading</h1>", "<strong>Bold</strong>", "<em>italic</em>", "<del>done</del>", "<blockquote>", "<ul>", "<table>", 'class="language-ts"']) {
    assert.ok(html.includes(fragment), fragment);
  }
  assert.match(html, /&lt;script&gt;/);
});

test("notes preview strips executable HTML, unsafe URLs, styles, and remote images", () => {
  const html = renderNoteMarkdown([
    '<script>alert(1)</script><style>body{display:none}</style>',
    '<iframe src="https://example.com"></iframe>',
    '<img src="https://example.com/tracker" onerror="alert(1)">',
    '<a href="javascript:alert(1)" onclick="alert(1)">unsafe</a>',
    '[unsafe](javascript:alert%281%29)',
    '[safe](https://example.com)',
    '<div style="position:fixed" onmouseover="alert(1)">Text</div>',
  ].join("\n\n"));
  assert.doesNotMatch(html, /<script|<style|<iframe|<img|javascript:|onclick|onerror|onmouseover|style=/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /Text/);
});

test("notes preview makes task checkboxes read-only", () => {
  const html = renderNoteMarkdown("- [ ] Open\n- [x] Complete");
  assert.match(html, /type="checkbox" disabled/);
  assert.match(html, /checked/);
  assert.doesNotMatch(html, /<form|onchange/);
});
