import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { webcrypto } from "node:crypto";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { ShareLinksStore } from "../src/share-links/store";
import { shareStoreLooksEncrypted } from "../src/share-links/routes";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const TOKEN = "t".repeat(32);

async function encryptSnapshot(title: string, html: string) {
  const key = await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const raw = await webcrypto.subtle.exportKey("raw", key);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify({ title, html })),
  );
  return {
    keyB64: Buffer.from(raw).toString("base64url"),
    ciphertext: Buffer.from(ciphertext).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
  };
}

async function openServer(env: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "cc-share-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: TOKEN,
    OWNER_EMAILS: "owner@example.com",
    TZ: "UTC",
    SHARE_LINKS_ENABLED: "1",
    ...env,
  });
  const notes = await NotesStore.open(dir);
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
      if (jwt === "reader") return { email: "reader@example.com" };
      throw new Error("bad jwt");
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ownerHeaders = { "cf-access-jwt-assertion": "owner", "x-ah": "1", "content-type": "application/json" };
  const readerHeaders = { "cf-access-jwt-assertion": "reader", "x-ah": "1", "content-type": "application/json" };
  const close = async () => {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, dir, notes, shareLinks: integration.shareLinks, ownerHeaders, readerHeaders, close };
}

test("share links: disabled by default and owner APIs stay closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-share-off-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, OWNER_EMAILS: "owner@example.com", TZ: "UTC" });
  assert.equal(cfg.shareLinksEnabled, false);
  const notes = await NotesStore.open(dir);
  const note = await notes.createNote({ title: "Secret title", content: "body" });
  const integration = await openIntegrationStores(dir, cfg);
  const settings = new SettingsStore(dir);
  await settings.load();
  const server = createApp({
    cfg,
    notes,
    ...integration,
    settings,
    dailyBriefing: await DailyBriefingService.open(dir, cfg.tz),
    auth: makeAuthenticator(cfg, async () => ({ email: "owner@example.com" })),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const enc = await encryptSnapshot("Secret title", "<p>x</p>");
    const create = await fetch(`${base}/api/knowledge/notes/${encodeURIComponent(note.id)}/share-links`, {
      method: "POST",
      headers: { "cf-access-jwt-assertion": "owner", "x-ah": "1", "content-type": "application/json" },
      body: JSON.stringify({ ciphertext: enc.ciphertext, iv: enc.iv, expiresInSeconds: 3600 }),
    });
    assert.equal(create.status, 404);
    assert.equal((await fetch(`${base}/share/not-a-valid-share-id`)).status, 401);
    assert.equal((await fetch(`${base}/api/settings`)).status, 401);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("share links: create/list/revoke need owner; public routes need no JWT; protected routes still require auth", async () => {
  const h = await openServer({});
  try {
    const note = await h.notes.createNote({ title: "Share me", content: "# Hello" });
    const enc = await encryptSnapshot("Share me", "<p>Hello</p>");

    assert.equal((await fetch(`${h.base}/api/knowledge/notes/${note.id}/share-links`, {
      method: "POST",
      headers: h.readerHeaders,
      body: JSON.stringify({ ciphertext: enc.ciphertext, iv: enc.iv, expiresInSeconds: 86400 }),
    })).status, 403);

    const created = await fetch(`${h.base}/api/knowledge/notes/${encodeURIComponent(note.id)}/share-links`, {
      method: "POST",
      headers: h.ownerHeaders,
      body: JSON.stringify({ ciphertext: enc.ciphertext, iv: enc.iv, expiresInSeconds: 86400 }),
    });
    assert.equal(created.status, 201);
    const { id } = await created.json() as { id: string };
    assert.match(id, /^[A-Za-z0-9_-]{22}$/);

    const raw = await readFile(join(h.dir, "share-links.json"), "utf8");
    assert.equal(shareStoreLooksEncrypted(raw, "Share me"), true);
    assert.equal(raw.includes(enc.keyB64), false);

    const list = await fetch(`${h.base}/api/knowledge/share-links`, { headers: { "cf-access-jwt-assertion": "owner" } });
    assert.equal(list.status, 200);
    assert.equal((await list.json()).links.length, 1);

    const page = await fetch(`${h.base}/share/${id}`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.match(page.headers.get("content-security-policy") ?? "", /script-src 'self'/);
    assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow");

    const data = await fetch(`${h.base}/share/${id}/data`);
    assert.equal(data.status, 200);
    const payload = await data.json() as { ciphertext: string; iv: string };
    assert.equal(payload.ciphertext, enc.ciphertext);

    assert.equal((await fetch(`${h.base}/api/settings`)).status, 401);
    assert.equal((await fetch(`${h.base}/api/notes`, { headers: { "cf-access-jwt-assertion": "owner" } })).status, 200);

    assert.equal((await fetch(`${h.base}/api/knowledge/share-links/${id}`, { method: "DELETE", headers: h.ownerHeaders })).status, 200);
    assert.equal((await fetch(`${h.base}/share/${id}/data`)).status, 404);
    assert.equal((await fetch(`${h.base}/share/${id}`)).status, 404);
  } finally {
    await h.close();
  }
});

test("share links: sensitive notes, invalid ids, size cap, expiry purge, and rate limit", async () => {
  const h = await openServer({ SHARE_LINKS_MAX_ACTIVE: "1" });
  try {
    const sensitive = await h.notes.createNote({ title: "Nope", content: "x", sensitive: true });
    const enc = await encryptSnapshot("Nope", "<p>x</p>");
    assert.equal((await fetch(`${h.base}/api/knowledge/notes/${sensitive.id}/share-links`, {
      method: "POST",
      headers: h.ownerHeaders,
      body: JSON.stringify({ ciphertext: enc.ciphertext, iv: enc.iv, expiresInSeconds: 3600 }),
    })).status, 403);

    assert.equal((await fetch(`${h.base}/share/notvalid`)).status, 404);
    assert.equal((await fetch(`${h.base}/share/${"A".repeat(22)}/data`)).status, 404);

    const note = await h.notes.createNote({ title: "One", content: "a" });
    assert.equal((await fetch(`${h.base}/api/knowledge/notes/${note.id}/share-links`, {
      method: "POST",
      headers: h.ownerHeaders,
      body: JSON.stringify({ ciphertext: "A".repeat(600_000), iv: Buffer.from("iv").toString("base64"), expiresInSeconds: 3600 }),
    })).status, 400);

    const ok = await encryptSnapshot("One", "<p>ok</p>");
    const first = await (await fetch(`${h.base}/api/knowledge/notes/${note.id}/share-links`, {
      method: "POST",
      headers: h.ownerHeaders,
      body: JSON.stringify({ ciphertext: ok.ciphertext, iv: ok.iv, expiresInSeconds: 3600 }),
    })).json() as { id: string };

    assert.equal((await fetch(`${h.base}/api/knowledge/notes/${note.id}/share-links`, {
      method: "POST",
      headers: h.ownerHeaders,
      body: JSON.stringify({ ciphertext: ok.ciphertext, iv: ok.iv, expiresInSeconds: 3600 }),
    })).status, 400);

    const expiredId = first.id;
    const file = JSON.parse(await readFile(join(h.dir, "share-links.json"), "utf8")) as { links: { id: string; expiresAt: string }[] };
    file.links[0]!.expiresAt = new Date(Date.now() - 60_000).toISOString();
    await writeFile(join(h.dir, "share-links.json"), JSON.stringify(file));
    const reloaded = await ShareLinksStore.open(h.dir);
    assert.equal(reloaded.get(expiredId), undefined);
    await reloaded.purgeExpired();
    assert.equal(JSON.parse(await readFile(join(h.dir, "share-links.json"), "utf8")).links.length, 0);

  } finally {
    await h.close();
  }
});

test("share links: public routes rate limit per IP", async () => {
  const h = await openServer({ SHARE_LINKS_RATE_LIMIT_PER_MINUTE: "3" });
  try {
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${h.base}/assets/share-viewer.js`);
      if (i < 3) assert.equal(res.status, 200);
      else assert.equal(res.status, 429);
    }
  } finally {
    await h.close();
  }
});

test("share link store rejects invalid expiry and damaged files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-share-store-"));
  try {
    const store = await ShareLinksStore.open(dir);
    await assert.rejects(store.create({
      noteId: "n1",
      ciphertext: Buffer.from("x").toString("base64"),
      iv: Buffer.from("y").toString("base64"),
      expiresInSeconds: 999 as 3600,
      maxActive: 5,
      maxCiphertextBytes: 1000,
    }), /expiresInSeconds/);
    await writeFile(join(dir, "share-links.json"), JSON.stringify({ links: [{ id: "short", noteId: "n", ciphertext: "YQ==", iv: "YQ==", expiresAt: new Date().toISOString(), createdAt: new Date().toISOString() }] }));
    await assert.rejects(ShareLinksStore.open(dir), /Invalid share-links.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
