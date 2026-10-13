import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicIp, assertPublicUrl } from "../src/ssrf";
import { parseSources, parseFeed } from "../src/sources";
import { requestCost, PRICING } from "../src/pricing";
import { dueSlot, slotInstant } from "../src/scheduler";
import { applySettings, DEFAULT_SETTINGS, ValidationError } from "../src/settings";
import { dayKey, spendTotals } from "../src/store";

test("ssrf: private, loopback, metadata and mapped addresses are refused", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.9", "169.254.169.254", "172.16.0.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
    assert.equal(isPublicIp(ip), false, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) assert.equal(isPublicIp(ip), true, ip);
});

test("ssrf: assertPublicUrl checks scheme, credentials, literals and DNS answers", async () => {
  const pub = async () => ["93.184.216.34"];
  await assertPublicUrl("https://example.com/x", pub);
  for (const bad of ["file:///etc/passwd", "ftp://example.com", "https://user:pw@example.com", "http://127.0.0.1/", "http://[::1]/", "http://localhost/", "http://router/", "http://nas.local/", "http://2130706433/"]) {
    await assert.rejects(assertPublicUrl(bad, pub), bad);
  }
  await assert.rejects(assertPublicUrl("https://rebind.example/", async () => ["93.184.216.34", "10.0.0.1"]));
  await assert.rejects(assertPublicUrl("https://nx.example/", async () => { throw new Error("ENOTFOUND"); }));
});

test("sources: syntax, detection, weights and errors", () => {
  const { sources, errors } = parseSources(`# c
hn
hn:best *5
github:anthropics/claude-code
github:foo/bar#issues
rss:https://a.example/feed
https://b.example/feed.xml
https://news.example/
web:https://c.example *2
hn
ftp://x
nonsense
hn:bogus`);
  assert.deepEqual(sources.map((s) => [s.kind, s.weight]), [
    ["hn", 3], ["hn", 5], ["github", 3], ["github", 3], ["rss", 3], ["rss", 3], ["web", 3], ["web", 2],
  ]);
  assert.equal(sources[2]!.url, "https://api.github.com/repos/anthropics/claude-code/releases");
  assert.equal(sources[3]!.url, "https://api.github.com/repos/foo/bar/issues");
  assert.deepEqual(errors.map((e) => e.line), [10, 11, 12, 13]);
});

test("sources: RSS, Atom and RDF parse; scripts in summaries are stripped", () => {
  const rss = `<rss><channel><item><title>A &amp; B</title><link>/a</link><description>&lt;script&gt;x&lt;/script&gt;hello &lt;b&gt;bold&lt;/b&gt;</description><pubDate>Mon</pubDate></item></channel></rss>`;
  const [a] = parseFeed(rss, "https://x.example/feed");
  assert.equal(a!.title, "A & B");
  assert.equal(a!.link, "https://x.example/a");
  assert.ok(!/script|<b>/.test(a!.summary ?? ""), a!.summary);
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>T</title><link rel="alternate" href="https://y.example/1"/><updated>2026-01-01</updated></entry></feed>`;
  assert.equal(parseFeed(atom, "https://y.example")[0]!.link, "https://y.example/1");
  const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><item><title>R</title><link>https://z.example/r</link></item></rdf:RDF>`;
  assert.equal(parseFeed(rdf, "https://z.example")[0]!.title, "R");
  assert.throws(() => parseFeed("<html></html>", "https://x"));
});

test("pricing: tokens priced per request; Haiku long-context tier; unknown model assumed dearest", () => {
  const u = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
  assert.equal(requestCost("claude-sonnet-5-5", u), 12);
  assert.ok(Math.abs(requestCost("claude-haiku-5-5", { ...u, inputTokens: 50_000, outputTokens: 0 }) - 0.005) < 1e-9);
  // 100k+ prompt (cache reads count) flips the whole request to the long rate
  const long = requestCost("claude-haiku-5-5", { inputTokens: 10, outputTokens: 0, cacheReadTokens: 100_000, cacheWriteTokens: 0 });
  assert.ok(Math.abs(long - (10 * 0.5 + 100_000 * 0.05) / 1e6) < 1e-9);
  assert.equal(requestCost("mystery", u), requestCost("claude-opus-5-5", u));
  assert.ok(PRICING["claude-sonnet-5-5"]);
});

test("scheduler: slot times respect the zone, catch-up is today-only, one retry after 30 minutes", () => {
  const tz = "America/Chicago";
  assert.equal(slotInstant("2026-10-13", "06:30", tz).toISOString(), "2026-10-13T11:30:00.000Z"); // CDT = UTC-5
  assert.equal(slotInstant("2026-12-01", "06:30", tz).toISOString(), "2026-12-01T12:30:00.000Z"); // CST = UTC-6
  const times = ["06:30", "18:00"];
  const at = (iso: string) => new Date(iso);
  assert.equal(dueSlot({}, times, at("2026-10-13T11:00:00Z"), tz), null); // 06:00 local, before the first slot
  assert.equal(dueSlot({}, times, at("2026-10-13T11:31:00Z"), tz), "2026-10-13 06:30");
  assert.equal(dueSlot({}, times, at("2026-10-13T20:00:00Z"), tz), "2026-10-13 06:30"); // restart at 15:00: catch up the morning one
  const done = { slot: "2026-10-13 06:30", attempts: 1, lastAt: "2026-10-13T11:31:00Z", lastStatus: "ok" as const };
  assert.equal(dueSlot(done, times, at("2026-10-13T20:00:00Z"), tz), null);
  assert.equal(dueSlot(done, times, at("2026-10-13T23:01:00Z"), tz), "2026-10-13 18:00");
  const failed = { ...done, lastStatus: "failed" as const };
  assert.equal(dueSlot(failed, times, at("2026-10-13T11:50:00Z"), tz), null);
  assert.equal(dueSlot(failed, times, at("2026-10-13T12:02:00Z"), tz), "2026-10-13 06:30");
  assert.equal(dueSlot({ ...failed, attempts: 2 }, times, at("2026-10-13T14:00:00Z"), tz), null);
});

test("settings: validated merge", () => {
  const s = applySettings(DEFAULT_SETTINGS, { times: ["18:00", "06:30"], caps: { daily: "5" }, blockedSites: "https://Bank.example/x\n#c" });
  assert.deepEqual(s.times, ["06:30", "18:00"]);
  assert.equal(s.caps.daily, 5);
  assert.deepEqual(s.blockedSites, ["bank.example"]);
  for (const bad of [{ times: ["25:00"] }, { caps: { perBuild: -1 } }, { model: "gpt" }, { keepEditions: 0 }, { scheduleEnabled: "yes" }, [], null]) {
    assert.throws(() => applySettings(DEFAULT_SETTINGS, bad), ValidationError);
  }
});

test("ledger totals use the configured calendar day and month", () => {
  const tz = "America/Chicago";
  const entries = [
    { ts: "2026-10-13T04:30:00Z", buildId: "a", status: "ok" as const, costUsd: 1 }, // Oct 12 23:30 local
    { ts: "2026-10-13T12:00:00Z", buildId: "b", status: "ok" as const, costUsd: 2 },
    { ts: "2026-09-30T12:00:00Z", buildId: "c", status: "ok" as const, costUsd: 4 },
  ];
  const t = spendTotals(entries, new Date("2026-10-13T15:00:00Z"), tz);
  assert.deepEqual(t, { today: 2, thisMonth: 3, buildsToday: 1 });
  assert.equal(dayKey(new Date("2026-10-13T04:30:00Z"), tz), "2026-10-12");
});
