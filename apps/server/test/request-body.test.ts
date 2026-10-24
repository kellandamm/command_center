import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const TOKEN = "r".repeat(32);

test("oversized POST bodies return 400 without connection reset", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-req-body-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    OWNER_EMAILS: "owner@example.com",
    TZ: "UTC",
    SHARE_LINKS_ENABLED: "1",
  });
  const notes = await NotesStore.open(dir);
  const note = await notes.createNote({ title: "Limit", content: "x" });
  const integration = await openIntegrationStores(dir, cfg);
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const server = createApp({
    cfg,
    notes,
    ...integration,
    settings,
    dailyBriefing,
    auth: makeAuthenticator(cfg, async (jwt) => {
      if (jwt === "owner") return { email: "owner@example.com" };
      throw new Error("bad jwt");
    }),
  });
  const ownerHeaders = { "cf-access-jwt-assertion": "owner", "x-ah": "1", "content-type": "application/json" };
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const url = `${base}/api/knowledge/notes/${note.id}/share-links`;
  const body = JSON.stringify({
    ciphertext: "A".repeat(600_000),
    iv: Buffer.from("iv").toString("base64"),
    expiresInSeconds: 3600,
  });

  try {
    for (let i = 0; i < 20; i++) {
      const res = await fetch(url, { method: "POST", headers: ownerHeaders, body });
      assert.equal(res.status, 400, `iteration ${i}`);
      const json = await res.json() as { error?: string };
      assert.match(json.error ?? "", /too large/i);
    }
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
