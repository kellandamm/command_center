import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NotesStore, NoteConflictError } from "../src/notes/store";

test("Notes preserve history, reject stale saves, restore conditionally, and retain revisions in backups", async () => {
  const dir = await mkdtemp(join(tmpdir(), "notes-history-"));
  const otherDir = await mkdtemp(join(tmpdir(), "notes-history-import-"));
  try {
    const store = await NotesStore.open(dir);
    const note = await store.createNote({ title: "Meeting", content: "Original" });
    const id = note.id, version = note.version;
    await store.updateNote(id, { expectedVersion: version, content: "Changed" });
    await assert.rejects(store.updateNote(id, { expectedVersion: version, content: "Stale" }), NoteConflictError);
    assert.equal(store.getNote(id)!.content, "Changed");
    const history = store.noteHistory(id);
    assert.equal(history[0]!.content, "Original");
    const currentVersion = store.getNote(id)!.version!;
    await store.restoreNote(id, history[0]!.revisionId, currentVersion);
    assert.equal(store.getNote(id)!.content, "Original");
    assert.equal(store.noteHistory(id)[0]!.content, "Changed");
    await assert.rejects(store.restoreNote(id, history[0]!.revisionId, currentVersion), NoteConflictError);
    assert.equal((await NotesStore.open(dir)).noteHistory(id).length, 2);
    const imported = await NotesStore.open(otherDir);
    await imported.importBackup(store.exportBackup());
    assert.equal(imported.getNote(id)!.version, store.getNote(id)!.version);
    assert.deepEqual(imported.noteHistory(id), store.noteHistory(id));
    for (let i = 0; i < 22; i++) await store.updateNote(id, { content: String(i) });
    assert.equal(store.noteHistory(id).length, 20);
    await store.deleteNote(id);
    assert.deepEqual(store.noteHistory(id), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(otherDir, { recursive: true, force: true });
  }
});

test("legacy writes and agent appends advance versions and snapshot prior text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "notes-history-"));
  try {
    const store = await NotesStore.open(dir);
    await store.write("Before");
    const note = store.listNotes()[0]!, version = note.version ?? 0;
    await store.append("Agent addition");
    assert.equal(store.getNote(note.id)!.version, version + 1);
    assert.equal(store.noteHistory(note.id)[0]!.content, "Before");
    await assert.rejects(store.updateNote(note.id, { expectedVersion: version, content: "Stale" }), NoteConflictError);
    await store.write("After");
    assert.equal(store.noteHistory(note.id)[0]!.content, "Before\nAgent addition\n");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("note pin/archive metadata validates, persists, restores with history, and round-trips backups", async () => {
  const dir = await mkdtemp(join(tmpdir(), "notes-organizing-"));
  const importedDir = await mkdtemp(join(tmpdir(), "notes-organizing-import-"));
  try {
    let store = await NotesStore.open(dir);
    const note = await store.createNote({ title: "Research", content: "Text" });
    const id = note.id;
    assert.equal(note.pinned, false);
    assert.equal(note.archivedAt, null);
    const archived = "2026-10-22T12:00:00.000Z";
    await store.updateNote(id, { pinned: true, archivedAt: archived, expectedVersion: 1 });
    assert.equal(store.getNote(id)?.pinned, true);
    assert.equal(store.getNote(id)?.archivedAt, archived);
    await assert.rejects(store.updateNote(id, { pinned: "true", expectedVersion: 2 }), /boolean/);
    await assert.rejects(store.updateNote(id, { archivedAt: "yesterday", expectedVersion: 2 }), /ISO timestamp/);
    await assert.rejects(store.updateNote(id, { pinned: false, expectedVersion: 1 }), NoteConflictError);
    assert.equal(store.getNote(id)?.version, 2);
    assert.equal(store.noteHistory(id).length, 1);
    store = await NotesStore.open(dir);
    assert.equal(store.getNote(id)?.archivedAt, archived);
    const imported = await NotesStore.open(importedDir);
    await imported.importBackup(store.exportBackup());
    assert.equal(imported.getNote(id)?.pinned, true);
    assert.equal(imported.getNote(id)?.archivedAt, archived);
    const revision = store.noteHistory(id)[0]!;
    await store.restoreNote(id, revision.revisionId, 2);
    assert.equal(store.getNote(id)?.pinned, false);
    assert.equal(store.getNote(id)?.archivedAt, null);
    await store.updateNote(id, { pinned: true, archivedAt: archived });
    await store.restoreNote(id, store.noteHistory(id)[0]!.revisionId, 4);
    const archiveRevision = store.noteHistory(id).find((row) => row.archivedAt === archived)!;
    await store.restoreNote(id, archiveRevision.revisionId, 5);
    assert.equal(store.getNote(id)?.pinned, true);
    assert.equal(store.getNote(id)?.archivedAt, archived);
    assert.ok(store.listNotes("Research").some((row) => row.id === id), "archive is organization, not an access or search boundary");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(importedDir, { recursive: true, force: true });
  }
});
