import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { actionNotesAppend, actionNotesRead } from "../src/mcp/actions";
import { SENSITIVE_LEGACY_NOTE_MESSAGE } from "../src/notes/sensitive";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const TOKEN = "m".repeat(32);
const authz = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-ah": "1" };

async function legacyHarness() {
  const dir = await mkdtemp(join(tmpdir(), "cc-mcp-legacy-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "1", TZ: "UTC" });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const deps = { cfg, notes, ...integration };
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg),
    settings,
    dailyBriefing,
    notes,
    ...integration,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, deps, notes, close };
}

async function markLegacySensitive(store: NotesStore) {
  await store.write("AGENT_SECRET_BODY");
  const legacy = store.mainLegacyNote()!;
  await store.updateNote(legacy.id, { sensitive: true, expectedVersion: legacy.version ?? 0 });
}

test("mcp legacy notes: read and append redact sensitive Main notes", async () => {
  const h = await legacyHarness();
  try {
    await markLegacySensitive(h.notes);
    const read = await actionNotesRead(h.deps);
    assert.deepEqual(read, { content: "", redacted: true });

    const append = await actionNotesAppend(h.deps, "copilot", "must not persist");
    assert.deepEqual(append, { content: "", redacted: true });
    assert.equal(await h.notes.read(), "AGENT_SECRET_BODY");

    const api = await fetch(`${h.base}/api/notes`, { headers: authz });
    const body = await api.json();
    assert.equal(body.content, "");
    assert.equal(body.redacted, true);

    const put = await fetch(`${h.base}/api/notes`, {
      method: "PUT",
      headers: authz,
      body: JSON.stringify({ content: "" }),
    });
    assert.equal(put.status, 409);
    assert.equal((await put.json()).error, SENSITIVE_LEGACY_NOTE_MESSAGE);
    assert.equal(await h.notes.read(), "AGENT_SECRET_BODY");
  } finally {
    await h.close();
  }
});
