import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDocument, RenderError } from "../src/render";

const GOOD = `import React from 'react';
export default function PersonalizedHomepage() {
  const [n] = React.useState(1);
  return <main style={{padding: 8}}><h1>Hi {n}</h1><a href="https://example.com/a">x</a><p>{"</script><!-- sneaky"}</p></main>;
}`;

test("render: bundles into one self-contained document with a locked-down CSP", async () => {
  const html = await renderDocument(GOOD, "T <b>");
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.ok(!html.includes("T <b>"), "title escaped");
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1, "exactly one script element");
  assert.ok(!/<script[^>]*src=/i.test(html));
});

test("render: the CSP hash matches the inline script exactly", async () => {
  const { createHash } = await import("node:crypto");
  const html = await renderDocument(GOOD);
  const script = html.match(/<script>([\s\S]*)<\/script><\/body>/)![1]!;
  const hash = html.match(/'sha256-([^']+)'/)![1];
  assert.equal(createHash("sha256").update(script).digest("base64"), hash);
});

test("render: only react may be imported", async () => {
  for (const bad of [
    `import fs from 'node:fs'; export default function PersonalizedHomepage(){return fs}`,
    `import x from 'https://evil.example/x.js'; export default function PersonalizedHomepage(){return x}`,
    `import _ from 'lodash'; export default function PersonalizedHomepage(){return _}`,
    `import './style.css'; export default function PersonalizedHomepage(){return null}`,
    `export default function PersonalizedHomepage(){ import('fs'); return null }`,
  ]) {
    await assert.rejects(renderDocument(bad), RenderError, bad);
  }
});

test("render: syntax errors and missing components are reported, not thrown raw", async () => {
  await assert.rejects(renderDocument("export default function PersonalizedHomepage( {"), RenderError);
  await assert.rejects(renderDocument("const x = 1;"), RenderError);
});
