import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicIp, assertPublicUrl, readResponseBody } from "../src/ssrf";
import { dueBriefingSlot, slotInstant } from "../src/scheduler";
import { applySettings, DEFAULT_SETTINGS, ValidationError } from "../src/settings";
import { dayKey } from "../src/store";

test("ssrf: private, loopback, metadata and mapped addresses are refused", () => {
  for (const ip of [
    "127.0.0.1", "10.1.2.3", "192.168.0.9", "169.254.169.254", "172.16.0.1", "100.64.0.1", "0.0.0.0",
    "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1",
    "64:ff9b::127.0.0.1", "64:ff9b::7f00:1", "2002:0a00:0001::", "2002:c000:0202::",
  ]) {
    assert.equal(isPublicIp(ip), false, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) assert.equal(isPublicIp(ip), true, ip);
});

test("ssrf: assertPublicUrl checks scheme, credentials, literals and DNS answers", async () => {
  const pub = async () => ["93.184.216.34"];
  await assertPublicUrl("https://example.com/x", { resolve: pub });
  for (const bad of ["file:///etc/passwd", "ftp://example.com", "https://user:pw@example.com", "http://127.0.0.1/", "http://[::1]/", "http://localhost/", "http://router/", "http://nas.local/", "http://2130706433/"]) {
    await assert.rejects(assertPublicUrl(bad, { resolve: pub }), bad);
  }
  await assert.rejects(assertPublicUrl("https://rebind.example/", { resolve: async () => ["93.184.216.34", "10.0.0.1"] }));
});

test("ssrf: assertPublicUrl times out a hanging DNS lookup", async () => {
  const { BlockedUrlError } = await import("../src/ssrf");
  await assert.rejects(
    assertPublicUrl("https://example.com/", { timeoutMs: 40, resolve: () => new Promise(() => {}) }),
    (err: unknown) => err instanceof BlockedUrlError && err.message === "timeout",
  );
});

test("ssrf: readResponseBody truncates at maxBytes without hanging", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("a".repeat(8_192));
    res.end("b".repeat(8_192));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    const req = httpRequest({ host: "127.0.0.1", port, path: "/big", method: "GET" });
    req.end();
    const res = await readResponseBody(req, 4_096, 5_000);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 4_096);
    assert.equal(res.body.toString("utf8"), "a".repeat(4_096));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test("scheduler: slot times respect the zone; catch-up and retry", () => {
  const tz = "America/Chicago";
  assert.equal(slotInstant("2026-10-13", "06:30", tz).toISOString(), "2026-10-13T11:30:00.000Z");
  const at = (iso: string) => new Date(iso);
  assert.equal(dueBriefingSlot({}, "06:30", at("2026-10-13T11:00:00Z"), tz), null);
  assert.equal(dueBriefingSlot({}, "06:30", at("2026-10-13T11:31:00Z"), tz), "2026-10-13 06:30");
  const done = { slot: "2026-10-13 06:30", attempts: 1, lastAt: "2026-10-13T11:31:00Z", lastStatus: "ok" as const };
  assert.equal(dueBriefingSlot(done, "06:30", at("2026-10-13T23:01:00Z"), tz), null);
  assert.equal(dueBriefingSlot(done, "18:00", at("2026-10-13T23:01:00Z"), tz), "2026-10-13 18:00");
  const failed = { ...done, lastStatus: "failed" as const };
  assert.equal(dueBriefingSlot(failed, "06:30", at("2026-10-13T11:45:00Z"), tz), null);
  assert.equal(dueBriefingSlot(failed, "06:30", at("2026-10-13T12:01:00Z"), tz), done.slot);
  assert.equal(dueBriefingSlot({ ...failed, attempts: 2 }, "06:30", at("2026-10-13T12:01:00Z"), tz), null);
});

test("settings: validated merge", () => {
  const s = applySettings(DEFAULT_SETTINGS, { briefingTime: "18:00" });
  assert.equal(s.briefingTime, "18:00");
  for (const bad of [{ briefingTime: "25:00" }, [], null]) {
    assert.throws(() => applySettings(DEFAULT_SETTINGS, bad), ValidationError);
  }
});

test("dayKey uses configured calendar day", () => {
  assert.equal(dayKey(new Date("2026-10-13T04:30:00Z"), "America/Chicago"), "2026-10-12");
});
