import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { assertReadOnlyDockerPath } from "../src/docker/read-client";
import { formatBytes, memoryUsedPercent, sampleCpuUsedPercent } from "../src/host/metrics";
import { BriefingService } from "../src/briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { NewsPrefsStore } from "../src/feeds/news-prefs";
import { FeedsStore } from "../src/feeds/store";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";

const TOKEN = "t".repeat(32);

test("host metrics helpers", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.50 KB");
  assert.equal(memoryUsedPercent(100, 25), 75);
  const a = sampleCpuUsedPercent(1000);
  const b = sampleCpuUsedPercent(1100);
  if (a !== null) assert.ok(a >= 0 && a <= 100);
  if (b !== null) assert.ok(b >= 0 && b <= 100);
});

test("docker client allows only read-only paths", () => {
  assert.throws(() => assertReadOnlyDockerPath("/containers/foo/stop"), /not allowed/);
  assert.doesNotThrow(() => assertReadOnlyDockerPath("/containers/json"));
  assert.doesNotThrow(() => assertReadOnlyDockerPath("/containers/json?all=1"));
});

test("http: host-health API returns host metrics and disabled docker without socket", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-hh-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    TZ: "UTC",
    ALLOW_INSECURE_NO_AUTH: "1",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const feeds = await FeedsStore.open(dir);
  const newsPrefs = await NewsPrefsStore.open(dir);
  const briefing = await BriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const server = createApp({ cfg, auth: makeAuthenticator(cfg), settings, feeds, briefing, newsPrefs, notes });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const r = await fetch(`${base}/api/host-health`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(r.status, 200);
    const j: any = await r.json();
    assert.equal(j.readOnly, true);
    assert.ok(j.host.memory.totalBytes > 0);
    assert.equal(j.docker.available, false);
    assert.match(j.docker.reason, /DOCKER_SOCKET/);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
