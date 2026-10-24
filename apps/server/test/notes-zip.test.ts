import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateRawSync } from "node:zlib";
import { zip } from "../src/read-later/zip";
import { NotesStore } from "../src/notes/store";
import { assertSafeZipEntryPath, isZipSymlinkEntry } from "../src/notes/zip-path";
import { readNotesZip } from "../src/notes/zip-read";
import { DEFAULT_NOTES_ZIP_LIMITS, type NotesZipLimits } from "../src/notes/zip-limits";
import { buildNotesZipExport } from "../src/notes/zip-export";
import { stripNotionHexFromBasename, normalizeWikiLinks } from "../src/notes/zip-vault";
import { sanitizeImportedMarkdown } from "../src/notes/sanitize-note-content";

const tightLimits: NotesZipLimits = {
  ...DEFAULT_NOTES_ZIP_LIMITS,
  maxCompressedBytes: 512_000,
  maxUncompressedBytes: 512_000,
  maxEntryBytes: 64_000,
  maxEntries: 20,
  maxCompressionRatio: 20,
};

function evilDeflateZip(uncompressedSize: number, compressedSize: number, payload: Buffer, fileName: string): Buffer {
  const name = Buffer.from(fileName);
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(compressedSize, 18);
  local.writeUInt32LE(uncompressedSize, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(compressedSize, 20);
  central.writeUInt32LE(uncompressedSize, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + payload.length, 16);
  return Buffer.concat([local, payload, central, end]);
}

test("zip path: rejects zip-slip variants", () => {
  assert.throws(() => assertSafeZipEntryPath("../secret.md"), /\.\./);
  assert.throws(() => assertSafeZipEntryPath("a/../b.md"), /\.\./);
  assert.throws(() => assertSafeZipEntryPath("/etc/passwd"), /relative/);
  assert.throws(() => assertSafeZipEntryPath("C:\\notes\\x.md"), /forward slashes/);
  assert.throws(() => assertSafeZipEntryPath("C:notes/x.md"), /drive/i);
  assert.throws(() => assertSafeZipEntryPath("folder\\note.md"), /forward slashes/);
  assert.equal(assertSafeZipEntryPath("vault/note.md"), "vault/note.md");
});

test("zip path: detects symlink external attributes", () => {
  const symlinkAttrs = (0o120755 & 0xffff) << 16;
  const fileAttrs = (0o100644 & 0xffff) << 16;
  assert.equal(isZipSymlinkEntry(symlinkAttrs), true);
  assert.equal(isZipSymlinkEntry(fileAttrs), false);
});

test("vault: notion hex stripping and wikilinks", () => {
  assert.equal(stripNotionHexFromBasename("My Page abcdef0123456789abcdef0123456789"), "My Page");
  assert.equal(normalizeWikiLinks("See [[Target|Alias]]"), "See [[Target]]");
});

test("sanitize: strips script tags from imported markdown", () => {
  const cleaned = sanitizeImportedMarkdown("# Hi\n<script>alert(1)</script>\n**bold**");
  assert.ok(!cleaned.includes("<script"));
  assert.ok(!sanitizeImportedMarkdown("<script>alert(1)</script >").includes("<script"));
  assert.match(cleaned, /\*\*bold\*\*/);
});

test("zip read: imports folder tree and skips attachments", async () => {
  const archive = zip([
    { name: "Research/topic.md", data: Buffer.from("# Topic\n\nSee [[Other]].") },
    { name: "Research/attachments/photo.png", data: Buffer.from("png") },
    { name: ".obsidian/config", data: Buffer.from("{}") },
  ]);
  const parsed = await readNotesZip(archive, tightLimits);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0]!.path, "Research/topic.md");
  assert.deepEqual(parsed.skippedAttachments, ["Research/attachments/photo.png"]);
  assert.ok(parsed.skippedOther.some((p) => p.includes(".obsidian")));
});

test("zip read: rejects zip-slip archive paths", async () => {
  const archive = zip([{ name: "../evil.md", data: Buffer.from("x") }]);
  await assert.rejects(readNotesZip(archive, tightLimits), /\.\./);
});

test("zip read: rejects compression ratio from headers", async () => {
  const payload = deflateRawSync(Buffer.from("a"));
  const archive = evilDeflateZip(10_000, payload.length, payload, "bomb.md");
  await assert.rejects(readNotesZip(archive, tightLimits), /compression ratio/i);
});

test("zip read: enforces entry count cap", async () => {
  const files = Array.from({ length: 25 }, (_, i) => ({ name: `n${i}.md`, data: Buffer.from("x") }));
  const archive = zip(files);
  await assert.rejects(readNotesZip(archive, tightLimits), /too many entries/i);
});

test("knowledge zip import: maps folders to spaces, renames duplicates, rolls back atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-zip-import-"));
  try {
    const store = await NotesStore.open(dir);
    const existingSpace = await store.createSpace({ name: "Research" });
    await store.createNote({ title: "Topic", content: "existing", spaceId: existingSpace.id });
    const archive = zip([
      { name: "Research/topic.md", data: Buffer.from("---\ntitle: Topic\n---\n\nNew body") },
      { name: "Research/nested/deep.md", data: Buffer.from("Deep") },
      { name: "Research/attachments/file.pdf", data: Buffer.from("%PDF") },
    ]);
    const parsed = await readNotesZip(archive, DEFAULT_NOTES_ZIP_LIMITS);
    const result = await store.importZipEntries(parsed);
    assert.equal(result.notesAdded, 2);
    assert.equal(result.spacesAdded, 0);
    assert.equal(result.duplicatesRenamed, 1);
    assert.equal(result.skippedAttachments.length, 1);
    const notes = store.listNotes();
    const renamed = notes.find((note) => note.title === "Topic (2)");
    assert.ok(renamed);
    assert.equal(renamed?.spaceId, store.listSpaces().find((s) => s.name === "Research")?.id);
    const deep = notes.find((note) => note.title === "deep");
    assert.ok(deep?.tags.includes("nested"));

    const badArchive = zip([{ name: "overflow.md", data: Buffer.alloc(250_000, "x") }]);
    const badParsed = await readNotesZip(badArchive, DEFAULT_NOTES_ZIP_LIMITS);
    const before = store.listNotes().length;
    await assert.rejects(store.importZipEntries(badParsed), /exceeds/);
    assert.equal(store.listNotes().length, before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("knowledge zip export: folder tree and sensitive hook", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-zip-export-"));
  try {
    const store = await NotesStore.open(dir);
    const space = await store.createSpace({ name: "Research" });
    await store.createNote({ title: "Alpha", content: "One", spaceId: space.id });
    await store.createNote({ title: "Beta", content: "Two", spaceId: null });
    const { zip: archive, exported, skippedSensitive } = buildNotesZipExport(store.listNotes(), store.listSpaces());
    assert.equal(exported, 2);
    assert.equal(skippedSensitive, 0);
    const parsed = await readNotesZip(archive, DEFAULT_NOTES_ZIP_LIMITS);
    assert.equal(parsed.entries.length, 2);
    assert.ok(parsed.entries.some((e) => e.path === "Research/Alpha.md"));
    assert.ok(parsed.entries.some((e) => e.path === "Beta.md"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
