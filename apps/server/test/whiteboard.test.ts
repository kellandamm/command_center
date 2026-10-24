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
import { OWNER_ACTION_FORBIDDEN } from "../src/owner-auth";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";
import { sanitizeWhiteboardScene, MAX_WHITEBOARD_SCENE_BYTES } from "../src/whiteboard/sanitize";
import { WhiteboardStore } from "../src/whiteboard/store";
import { whiteboardPage } from "../src/ui/whiteboard-page";

const TOKEN = "w".repeat(32);

test("whiteboard page does not leak layout css as visible head text", () => {
  const html = whiteboardPage();
  const bodyStart = html.indexOf("<body>");
  const lastStyleClose = html.lastIndexOf("</style>", bodyStart);
  const headTail = html.slice(lastStyleClose + "</style>".length, bodyStart);
  assert.doesNotMatch(headTail, /\.agent-tabs\{display:flex/);
  assert.match(html, /<link rel="stylesheet" href="\/assets\/excalidraw\/index\.css"/);
  assert.match(html, /<script defer src="\/assets\/whiteboard-editor\.js"><\/script>/);
});

test("whiteboard sanitize allowlists embedded images only", () => {
  const scene = sanitizeWhiteboardScene({
    type: "excalidraw",
    version: 2,
    elements: [
      { type: "image", fileId: "ok" },
      { type: "image", fileId: "gone" },
      { type: "rectangle" },
    ],
    files: {
      https: { dataURL: "https://evil.example/x.png", mimeType: "image/png" },
      js: { dataURL: "javascript:alert(1)", mimeType: "image/png" },
      html: { dataURL: "data:text/html;base64,PHNjcmlwdD4=", mimeType: "text/html" },
      proto: { dataURL: "//evil.example/x.png", mimeType: "image/png" },
      svg: { dataURL: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", mimeType: "image/svg+xml" },
      ok: { dataURL: "data:image/png;base64,aaaa", mimeType: "image/png" },
    },
  });
  assert.deepEqual(Object.keys(scene.files), ["ok"]);
  assert.equal(scene.elements.length, 2);
  assert.equal((scene.elements[0] as { fileId?: string }).fileId, "ok");
});

test("whiteboard sanitize keeps safe element links and drops unsafe ones", () => {
  const scene = sanitizeWhiteboardScene({
    elements: [
      { id: "1", type: "text", link: "https://example.com/docs" },
      { id: "2", type: "text", link: "javascript:alert(1)" },
      { id: "3", type: "text", link: "//evil.example" },
      { id: "4", type: "text", link: "mailto:user@example.com" },
      { id: "5", type: "text", link: "x".repeat(3_000) },
      { id: "6", type: "text", customData: { note: "y".repeat(3_000) } },
    ],
  });
  const byId = new Map(scene.elements.map((el) => [(el as { id: string }).id, el as { link?: string; customData?: unknown }]));
  assert.equal(byId.get("1")?.link, "https://example.com/docs");
  assert.equal(byId.get("2")?.link, undefined);
  assert.equal(byId.get("3")?.link, undefined);
  assert.equal(byId.get("4")?.link, "mailto:user@example.com");
  assert.equal(byId.get("5")?.link, undefined);
  assert.equal(byId.get("6")?.customData, undefined);
});

test("whiteboard sanitize rejects oversized scenes", () => {
  const huge = "x".repeat(MAX_WHITEBOARD_SCENE_BYTES);
  assert.throws(
    () => sanitizeWhiteboardScene({ elements: [{ id: "1", type: "text", text: huge }] }),
    /exceeds/,
  );
});

test("whiteboard store round-trip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-wb-"));
  try {
    const store = await WhiteboardStore.open(dir);
    const created = await store.create({ title: "Sketch" });
    const loaded = store.get(created.id);
    assert.equal(loaded?.title, "Sketch");
    const saved = await store.save(created.id, {
      title: "Renamed",
      scene: { type: "excalidraw", version: 2, elements: [{ id: "1", type: "rectangle" }], appState: {}, files: {} },
    });
    assert.equal(saved?.title, "Renamed");
    assert.equal(saved?.scene.elements.length, 1);
    const reopened = await WhiteboardStore.open(dir);
    assert.equal(reopened.get(created.id)?.title, "Renamed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("whiteboard routes enforce owner auth and body limits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-wb-api-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    TZ: "UTC",
    WHITEBOARD_ENABLED: "true",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
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
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-ah": "1" };
  try {
    const disabledCfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, TZ: "UTC" });
    assert.equal(disabledCfg.whiteboardEnabled, false);

    const list = await fetch(`${base}/api/whiteboard/scenes`, { headers });
    assert.equal(list.status, 200);
    const denied = await fetch(`${base}/api/whiteboard/scenes`, { method: "POST", headers, body: JSON.stringify({ title: "Nope" }) });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error, OWNER_ACTION_FORBIDDEN);

    const ownerServer = createApp({
      cfg,
      auth: async () => ({ ok: true, who: "owner@example.com", owner: true }),
      settings,
      dailyBriefing,
      notes,
      ...integration,
    });
    await new Promise<void>((r) => ownerServer.listen(0, "127.0.0.1", r));
    const ownerBase = `http://127.0.0.1:${(ownerServer.address() as AddressInfo).port}`;
    const created = await fetch(`${ownerBase}/api/whiteboard/scenes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Plan" }),
    });
    assert.equal(created.status, 201);
    const { scene: record } = await created.json() as { scene: { id: string } };
    const got = await fetch(`${ownerBase}/api/whiteboard/scenes/${encodeURIComponent(record.id)}`, { headers });
    assert.equal(got.status, 200);
    const saved = await fetch(`${ownerBase}/api/whiteboard/scenes/${encodeURIComponent(record.id)}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        scene: {
          type: "excalidraw",
          version: 2,
          elements: [{ id: "r1", type: "rectangle" }],
          appState: {},
          files: {},
        },
      }),
    });
    assert.equal(saved.status, 200);
    const payload = await saved.json() as { scene: { scene: { elements: unknown[] } } };
    assert.equal(payload.scene.scene.elements.length, 1);

    const tooBig = await fetch(`${ownerBase}/api/whiteboard/scenes`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Big",
        scene: { elements: [{ id: "1", type: "text", text: "z".repeat(MAX_WHITEBOARD_SCENE_BYTES) }] },
      }),
    });
    assert.equal(tooBig.status, 400);

    await new Promise<void>((resolve, reject) => ownerServer.close((err) => err ? reject(err) : resolve()));
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
