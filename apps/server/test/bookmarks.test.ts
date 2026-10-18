import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, rename, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BookmarksStore } from "../src/bookmarks/store";

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "cc-bookmarks-"));
  return { dir, store: await BookmarksStore.open(dir), close: () => rm(dir, { recursive: true, force: true }) };
}

test("bookmarks: groups, links, ordering, moves, layout, and deletion persist independently", async () => {
  const h = await harness();
  try {
    const work = await h.store.createGroup({ name: "Work" });
    const personal = await h.store.createGroup({ name: "Personal" });
    const first = await h.store.saveBookmark({ groupId: work.id, title: "Docs", url: "https://example.com/docs" });
    const second = await h.store.saveBookmark({ groupId: work.id, title: "Home", url: "https://example.com" });
    await h.store.moveBookmark({ id: second.id, direction: "up" });
    assert.deepEqual(h.store.list().bookmarks.map((item) => item.id), [second.id, first.id]);
    await h.store.saveBookmark({ ...first, groupId: personal.id, title: "Moved", description: "Reference" }, true);
    await h.store.updateGroup({ id: personal.id, name: "Reading", direction: "up" });
    await h.store.preferences({ density: "compact", columns: 4 });
    const reopened = await BookmarksStore.open(h.dir);
    assert.deepEqual(reopened.list(), h.store.list());
    assert.equal(reopened.list().groups[0]!.name, "Reading");
    assert.equal(reopened.list().bookmarks.find((item) => item.id === first.id)?.groupId, personal.id);
    await assert.rejects(h.store.deleteGroup({ id: work.id }), /Move or remove/);
    await h.store.deleteBookmark({ id: second.id });
    await h.store.deleteGroup({ id: work.id });
    assert.equal(h.store.list().groups.length, 1);
    assert.equal(h.store.list().bookmarks.length, 1);
    const copy = h.store.list();
    copy.groups[0]!.name = "Do not mutate store";
    assert.equal(h.store.list().groups[0]!.name, "Reading");
  } finally { await h.close(); }
});

test("bookmarks: reject unsafe links, invalid fields, dangling groups and missing records", async () => {
  const h = await harness();
  try {
    const group = await h.store.createGroup({ name: "Links" });
    for (const url of ["javascript:alert(1)", "data:text/html,bad", "file:///etc/passwd", "//example.com", "https://user:secret@example.com", "not a url"]) {
      await assert.rejects(h.store.saveBookmark({ groupId: group.id, title: "Bad", url }), /URL/);
    }
    await assert.rejects(h.store.createGroup({ name: " " }), /small/);
    await assert.rejects(h.store.saveBookmark({ title: "Missing group", groupId: "missing", url: "https://example.com" }), /group not found/);
    await assert.rejects(h.store.preferences({ density: "invalid", columns: 0 }));
    await assert.rejects(h.store.updateGroup({ id: "missing", name: "New" }), /Group not found/);
    await assert.rejects(h.store.saveBookmark({ id: "missing", groupId: group.id, title: "New", url: "https://example.com" }, true), /Bookmark not found/);
    assert.equal(h.store.list().bookmarks.length, 0);
  } finally { await h.close(); }
});

test("bookmarks: imports merge groups, deduplicate URLs, and round-trip exports", async () => {
  const h = await harness();
  try {
    const data = {
      groups: [{ id: "one", name: "Work" }, { id: "two", name: "Personal" }],
      bookmarks: [
        { groupId: "one", title: "Docs", url: "https://example.com" },
        { groupId: "one", title: "Duplicate", url: "https://example.com/" },
        { groupId: "two", title: "Same URL elsewhere", url: "https://example.com" },
      ],
    };
    assert.deepEqual(await h.store.import(data), { added: 2, skipped: 1 });
    assert.deepEqual(await h.store.import(h.store.list()), { added: 0, skipped: 2 });
    const before = h.store.list();
    await assert.rejects(h.store.import({ groups: [{ id: "new", name: "New" }], bookmarks: [{ groupId: "missing", title: "Bad", url: "https://example.com" }] }), /group not found/);
    await assert.rejects(h.store.import({ groups: [], bookmarks: [] }), /No bookmarks/);
    await assert.rejects(h.store.import({ groups: [{ id: "dup", name: "A" }, { id: "dup", name: "B" }], bookmarks: [{ groupId: "dup", title: "X", url: "https://example.com" }] }), /Duplicate group IDs/);
    assert.deepEqual(h.store.list(), before);
  } finally { await h.close(); }
});

test("bookmarks: serial writes and failed persistence never publish unsaved state", async () => {
  const h = await harness();
  try {
    await Promise.all(["A", "B", "C"].map((name) => h.store.createGroup({ name })));
    assert.deepEqual((await BookmarksStore.open(h.dir)).list(), h.store.list());
    const before = h.store.list();
    await rename(join(h.dir, "bookmarks.json"), join(h.dir, "saved.json"));
    await mkdir(join(h.dir, "bookmarks.json"));
    await assert.rejects(h.store.createGroup({ name: "Must not appear" }));
    assert.deepEqual(h.store.list(), before);
    await rm(join(h.dir, "bookmarks.json"), { recursive: true });
    await rename(join(h.dir, "saved.json"), join(h.dir, "bookmarks.json"));
    await h.store.createGroup({ name: "Recovered" });
    assert.equal(h.store.list().groups.length, 4);
  } finally { await h.close(); }
});

test("bookmarks: malformed persisted data fails explicitly", async () => {
  const h = await harness();
  try {
    await writeFile(join(h.dir, "bookmarks.json"), JSON.stringify({ groups: [], bookmarks: [{ id: "x", groupId: "missing", title: "Bad", url: "https://example.com" }] }));
    await assert.rejects(BookmarksStore.open(h.dir), /group not found/);
  } finally { await h.close(); }
});
