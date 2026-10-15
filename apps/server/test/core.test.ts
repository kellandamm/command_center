import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicIp, assertPublicUrl } from "../src/ssrf";
import { parseFeed, parseFeedList } from "../src/feeds/parse";
import { dueSlot, slotInstant } from "../src/scheduler";
import { applySettings, DEFAULT_SETTINGS, ValidationError } from "../src/settings";
import { dayKey } from "../src/store";
import { itemId, FeedsStore } from "../src/feeds/store";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
});

test("feeds: list syntax and hn shortcut", () => {
  const { feeds, errors } = parseFeedList(`# c\nhn\nhttps://a.example/feed.xml\nhn\nftp://x`);
  assert.equal(feeds.length, 2);
  assert.equal(feeds[0]!.id, "hn");
  assert.equal(feeds[1]!.url, "https://a.example/feed.xml");
  assert.equal(errors.length, 2);
});

test("feeds: RSS, Atom and RDF parse; scripts in summaries are stripped", () => {
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

test("feeds store: ingest, unread, mark read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-"));
  try {
    const store = await FeedsStore.open(dir);
    const now = new Date("2026-10-13T12:00:00Z");
    assert.equal(store.ingest("hn", [{ title: "One", link: "https://x/1" }], now), 1);
    assert.equal(store.ingest("hn", [{ title: "One", link: "https://x/1" }], now), 0);
    assert.equal(store.list({ unreadOnly: true }).length, 1);
    const id = itemId("hn", "https://x/1", "One");
    store.setStarred(id, true);
    assert.deepEqual(store.list({ starred: true }).map((item) => item.id), [id]);
    store.markRead([id]);
    assert.equal(store.list({ unreadOnly: true }).length, 0);
    store.markUnread([id]);
    assert.deepEqual(store.list({ unreadOnly: true }).map((item) => item.id), [id]);
    assert.equal(store.markAllRead({ starred: true }), 1);
    assert.equal(store.list({ starred: true, unreadOnly: true }).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scheduler: slot times respect the zone; catch-up and retry", () => {
  const tz = "America/Chicago";
  assert.equal(slotInstant("2026-10-13", "06:30", tz).toISOString(), "2026-10-13T11:30:00.000Z");
  const times = ["06:30", "18:00"];
  const at = (iso: string) => new Date(iso);
  assert.equal(dueSlot({}, times, at("2026-10-13T11:00:00Z"), tz), null);
  assert.equal(dueSlot({}, times, at("2026-10-13T11:31:00Z"), tz), "2026-10-13 06:30");
  const done = { slot: "2026-10-13 06:30", attempts: 1, lastAt: "2026-10-13T11:31:00Z", lastStatus: "ok" as const };
  assert.equal(dueSlot(done, times, at("2026-10-13T23:01:00Z"), tz), "2026-10-13 18:00");
});

test("settings: validated merge", () => {
  const s = applySettings(DEFAULT_SETTINGS, { briefingTime: "18:00", fetchIntervalMinutes: 15 });
  assert.equal(s.briefingTime, "18:00");
  assert.equal(s.fetchIntervalMinutes, 15);
  for (const bad of [{ briefingTime: "25:00" }, { fetchIntervalMinutes: 2 }, [], null]) {
    assert.throws(() => applySettings(DEFAULT_SETTINGS, bad), ValidationError);
  }
});

test("dayKey uses configured calendar day", () => {
  assert.equal(dayKey(new Date("2026-10-13T04:30:00Z"), "America/Chicago"), "2026-10-12");
});
