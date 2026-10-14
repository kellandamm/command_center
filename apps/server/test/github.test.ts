import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeIssues,
  describeEvent,
  issueKey,
  mapSearchItem,
  openIssueSearchQuery,
  openPrSearchQuery,
} from "../src/github/activity";

test("github: search queries target open PRs and issues for a user", () => {
  assert.equal(openPrSearchQuery("kellandamm"), "author:kellandamm is:pr is:open");
  assert.equal(openIssueSearchQuery("alice"), "is:issue is:open (author:alice OR assignee:alice)");
});

test("github: dedupe issues by repo and number", () => {
  const rows = [
    { number: 1, title: "a", url: "u1", repo: "o/r", updatedAt: "t1" },
    { number: 1, title: "a", url: "u1", repo: "o/r", updatedAt: "t2" },
    { number: 2, title: "b", url: "u2", repo: "o/r", updatedAt: "t3" },
  ];
  assert.equal(issueKey(rows[0]!), "o/r#1");
  assert.equal(dedupeIssues(rows).length, 2);
});

test("github: map search items and describe common events", () => {
  const item = mapSearchItem({
    number: 42,
    title: "Fix bug",
    html_url: "https://github.com/o/r/issues/42",
    updated_at: "2026-10-01T00:00:00Z",
    repository_url: "https://api.github.com/repos/o/r",
  });
  assert.equal(item.repo, "o/r");
  assert.equal(item.number, 42);

  const push = describeEvent({
    type: "PushEvent",
    created_at: "2026-10-01",
    repo: { name: "o/r" },
    payload: { ref: "refs/heads/main", commits: [{}, {}] },
  });
  assert.match(push.summary, /Pushed 2 commits/);
  assert.equal(push.url, "https://github.com/o/r");
});
