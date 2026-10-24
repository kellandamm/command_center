import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { composeAttentionSections } from "../src/attention/sections";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const TOKEN = "s".repeat(32);
const authz = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-ah": "1" };

test("sensitive notes: excluded from LLM ask, search body, attention, and export", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sensitive-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    ALLOW_INSECURE_NO_AUTH: "1",
    TZ: "UTC",
    LLM_BASE_URL: "https://api.example/v1",
    LLM_API_KEY: "sk-test",
    LLM_MODEL: "test-model",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({ cfg, auth: makeAuthenticator(cfg), settings, dailyBriefing, notes, ...integration });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const secret = await notes.createNote({ title: "Secret", content: "TOP_SECRET_BODY", sensitive: true });
  const publicNote = await notes.createNote({ title: "Public", content: "PUBLIC_BODY" });

  try {
    const search = await fetch(`${base}/api/knowledge?q=TOP_SECRET`, { headers: authz });
    const searchBody = await search.json();
    assert.equal(searchBody.notes.length, 0, "sensitive body must not match search");

    const titleSearch = await fetch(`${base}/api/knowledge?q=Secret`, { headers: authz });
    const titleBody = await titleSearch.json();
    assert.equal(titleBody.notes[0]?.title, "Secret");
    assert.equal(titleBody.notes[0]?.content, "");

    const backup = await fetch(`${base}/api/knowledge/export.json`, { headers: authz });
    const backupJson = await backup.json();
    assert.equal(backupJson.notes.length, 1);
    assert.equal(backupJson.notes[0].title, "Public");

    const fullBackup = await fetch(`${base}/api/knowledge/export.json?includeSensitive=true`, { headers: authz });
    const fullJson = await fullBackup.json();
    assert.equal(fullJson.notes.length, 2);

    const md = await fetch(`${base}/api/knowledge/export.md`, { headers: authz });
    const mdText = await md.text();
    assert.doesNotMatch(mdText, /TOP_SECRET_BODY/);
    assert.match(mdText, /PUBLIC_BODY/);

    let sentPrompt = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes("api.example")) {
        sentPrompt = String(init?.body ?? "");
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };
    try {
      const ask = await fetch(`${base}/api/knowledge/ask`, {
        method: "POST",
        headers: authz,
        body: JSON.stringify({ question: "What is secret?" }),
      });
      assert.equal(ask.status, 200);
      assert.doesNotMatch(sentPrompt, /TOP_SECRET_BODY/);
      assert.match(sentPrompt, /PUBLIC_BODY/);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const attention = composeAttentionSections({
      todayYmd: "2026-10-24",
      tz: "UTC",
      nowMs: Date.parse("2026-10-24T12:00:00.000Z"),
      cards: [],
      notes: [secret, publicNote],
      sources: [],
      wins: [],
      timeline: [
        { at: secret.updatedAt, kind: "note", refId: secret.id, title: secret.title },
        { at: publicNote.updatedAt, kind: "note", refId: publicNote.id, title: publicNote.title },
      ],
      pinned: [],
      hidden: new Set(),
      isSnoozed: () => false,
    });
    const continueIds = attention.find((s) => s.id === "continue")!.items.map((i) => i.id);
    assert.ok(!continueIds.includes(`note:${secret.id}`));
    assert.ok(continueIds.includes(`note:${publicNote.id}`));
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
