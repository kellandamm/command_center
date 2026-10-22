import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { NotesStore, NoteConflictError } from "../src/notes/store";
import { notesPage } from "../src/ui/notes-page";
import { renderNoteMarkdown } from "../src/notes/markdown";

async function ready(page: Page) {
  await page.waitForFunction(() => !(document.querySelector("#knowledge-fields") as HTMLFieldSetElement).disabled);
}
async function saved(page: Page) {
  await page.waitForFunction(() => document.querySelector("#knowledge-save-status")?.textContent === "Saved to your library");
}
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "cc-notes-productivity-"));
  const store = await NotesStore.open(dir);
  const first = await store.createNote({ title: "First", content: "alpha alpha\n\n[[Second]]", tags: ["work"] });
  const second = await store.createNote({ title: "Second", content: "Other note" });
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  const failures = { write: false, load: false };
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  await page.route("http://notes.test/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/notes") return route.fulfill({ contentType: "text/html", body: notesPage() });
    if (path === "/assets/notes-editor.js") return route.fulfill({ contentType: "text/javascript", body: await readFile(new URL("../dist/notes-editor.js", import.meta.url), "utf8") });
    if (path === "/api/knowledge") return route.fulfill(failures.load ? { status: 503, json: { error: "Store temporarily unavailable" } } : { json: store.search("") });
    if (path === "/api/knowledge/graph") return route.fulfill({ json: { nodes: [], edges: [] } });
    if (path === "/api/knowledge/preview") return route.fulfill({ json: { html: renderNoteMarkdown(request.postDataJSON().content) } });
    if (path.startsWith("/api/knowledge/notes")) {
      const id = path.split("/")[4];
      if (request.method() === "GET") return route.fulfill({ json: { note: store.getNote(id!) } });
      if (failures.write) return route.fulfill({ status: 503, json: { error: "Disk unavailable" } });
      try {
        const note = request.method() === "POST" ? await store.createNote(request.postDataJSON()) : await store.updateNote(id!, request.postDataJSON());
        return route.fulfill({ json: { note } });
      } catch (error) {
        return route.fulfill({ status: error instanceof NoteConflictError ? 409 : 400, json: { error: error instanceof Error ? error.message : "Failed" } });
      }
    }
    return route.fulfill({ json: {} });
  });
  return { page, store, first, second, failures, errors, close: async () => { await browser.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("Notes filters, tabs, templates, source replacement, slash insertion, duplication and archiving stay connected", { timeout: 90_000 }, async () => {
  const h = await setup(), { page, store, first, second } = h;
  try {
    await page.goto(`http://notes.test/notes?note=${first.id}`); await ready(page);
    await page.getByText("Document tools", { exact: true }).click();
    await page.getByRole("button", { name: "Pin note", exact: true }).click(); await saved(page);
    assert.equal(store.getNote(first.id)?.pinned, true);
    await page.locator("#knowledge-library-view").selectOption("pinned");
    assert.equal(await page.locator("#knowledge-note-list .notes-note").count(), 1);
    await page.locator("#knowledge-tag-filter").selectOption("work");
    assert.equal(await page.locator("#knowledge-note-list strong").innerText(), "First");
    await page.getByRole("button", { name: "All notes", exact: true }).click();
    await page.keyboard.press("Control+k");
    await page.locator("#knowledge-switch-query").fill("Second");
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
    await page.waitForFunction(() => (document.querySelector("#knowledge-title") as HTMLInputElement).value === "Second");
    assert.equal(await page.locator("#knowledge-tabs .notes-document-tab").count(), 2);
    await page.locator("#knowledge-tabs").getByRole("button", { name: "First", exact: true }).click();
    await page.getByRole("button", { name: "Close tab Second", exact: true }).click();
    assert.equal(await page.locator("#knowledge-tabs .notes-document-tab").count(), 1);
    await page.keyboard.press("Control+f");
    await page.locator("#knowledge-find").fill("alpha");
    await page.locator("#knowledge-replace").fill("$& beta");
    await page.getByRole("button", { name: "Find next", exact: true }).click();
    assert.equal(await page.locator("#knowledge-body").evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd)), "alpha");
    await page.getByRole("button", { name: "Replace all", exact: true }).click(); await saved(page);
    assert.equal(store.getNote(first.id)?.content, "$& beta $& beta\n\n[[Second]]");
    await page.locator("#knowledge-find").fill("beta");await page.locator("#knowledge-replace").fill("gamma");
    await page.getByRole("button", { name: "Find next", exact: true }).click();
    await page.getByRole("button", { name: "Write", exact: true }).click();
    await page.getByRole("button", { name: "Replace selected match", exact: true }).click(); await saved(page);
    assert.equal(store.getNote(first.id)?.content, "$& gamma $& beta\n\n[[Second]]");
    await page.locator("#knowledge-template").selectOption("meeting");
    await page.getByRole("button", { name: "Insert template", exact: true }).click(); await saved(page);
    assert.match(store.getNote(first.id)!.content, /Event link:/);
    assert.match(store.getNote(first.id)!.content, /\[\[Second\]\]/);
    await page.getByRole("button", { name: "Duplicate note", exact: true }).click();
    await page.waitForFunction(() => (document.querySelector("#knowledge-title") as HTMLInputElement).value === "First (copy)");
    const copy = store.listNotes().find((note) => note.title === "First (copy)")!;
    assert.equal(copy.pinned, false);
    assert.equal(copy.content, store.getNote(first.id)?.content);
    await page.getByRole("button", { name: "Archive note", exact: true }).click(); await saved(page);
    assert.ok(store.getNote(copy.id)?.archivedAt);
    assert.equal(await page.locator("#knowledge-note-list strong").filter({ hasText: "First (copy)" }).count(), 0);
    await page.locator("#knowledge-library-view").selectOption("archived");
    assert.equal(await page.locator("#knowledge-note-list strong").innerText(), "First (copy)");
    await page.getByRole("button", { name: "Restore from archive", exact: true }).click(); await saved(page);
    assert.equal(store.getNote(copy.id)?.archivedAt, null);
    await page.locator("#knowledge-library-view").selectOption("recent");
    assert.equal(await page.locator("#knowledge-note-list .notes-note").count(), 3);
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.getByRole("button", { name: "Write", exact: true }).click();
    const rich = page.getByRole("textbox", { name: "Note document", exact: true });
    await rich.click(); await page.keyboard.type("/");
    await page.waitForSelector("#knowledge-insert-menu:not([hidden])");
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
    await page.keyboard.type("Inserted heading"); await saved(page);
    assert.match(store.listNotes()[0]!.content, /^## Inserted heading/);
    assert.ok(!store.listNotes()[0]!.content.startsWith("/"));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.NOTES_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.NOTES_SCREENSHOT_DIR, "notes-tools-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (process.env.NOTES_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.NOTES_SCREENSHOT_DIR, "notes-tools-desktop.png"), fullPage: true });
    assert.deepEqual(h.errors, []);
    assert.ok(store.getNote(second.id));
  } finally { await h.close(); }
});

test("opt-in browser recovery survives reload, preserves stale versions, and requires explicit reviewed conflict resolution", { timeout: 90_000 }, async () => {
  const h = await setup(), { page, store, first, failures } = h;
  try {
    failures.load = true;
    await page.goto(`http://notes.test/notes?note=${first.id}`);
    await page.getByRole("button", { name: "Retry loading notes", exact: true }).waitFor();
    failures.load = false;
    await page.getByRole("button", { name: "Retry loading notes", exact: true }).click(); await ready(page);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("cc.notes.draft.")).length), 0);
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByText("Draft recovery", { exact: false }).first().click();
    await page.locator("#knowledge-drafts-enabled").check();
    failures.write = true;
    await page.locator("#knowledge-body").fill("Local recovery draft");
    await page.waitForFunction(() => document.querySelector("#knowledge-save-status")?.textContent?.includes("Not saved"));
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("cc.notes.draft.")).length), 1);
    await page.reload(); await ready(page);
    assert.equal(await page.locator("#knowledge-body").inputValue(), "alpha alpha\n\n[[Second]]");
    await store.updateNote(first.id, { content: "Remote edit", expectedVersion: first.version });
    await page.locator(".notes-recovery summary").first().click();
    await page.locator("#knowledge-drafts summary").click();
    await page.getByRole("button", { name: "Recover draft", exact: true }).click();
    assert.equal(await page.locator("#knowledge-body").inputValue(), "Local recovery draft");
    assert.equal(store.getNote(first.id)?.content, "Remote edit");
    await page.getByRole("button", { name: "New note", exact: true }).click();
    assert.equal(await page.locator("#knowledge-body").inputValue(), "Local recovery draft");
    assert.equal(store.getNote(first.id)?.content, "Remote edit", "navigation cannot implicitly save a recovered draft");
    failures.write = false;
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#knowledge-save-status")?.textContent?.includes("changed elsewhere"));
    await page.getByText("Document tools", { exact: true }).click();
    await page.getByRole("button", { name: "Review latest saved version", exact: true }).click();
    await page.locator("#knowledge-latest-content").waitFor();
    assert.equal(await page.locator("#knowledge-latest-content").inputValue(), "Remote edit");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.locator("#knowledge-body").fill("Remote edit\nLocal recovery draft");
    await store.updateNote(first.id, { content: "Another remote edit", expectedVersion: 2 });
    await page.getByRole("button", { name: "Save reviewed draft", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#knowledge-save-status")?.textContent?.includes("Not saved"));
    assert.equal(store.getNote(first.id)?.content, "Another remote edit", "reviewed version must not overwrite a newer save");
    await page.getByRole("button", { name: "Review latest saved version", exact: true }).click();
    await page.waitForFunction(() => (document.querySelector("#knowledge-latest-content") as HTMLTextAreaElement).value === "Another remote edit");
    await page.locator("#knowledge-body").fill("Another remote edit\nLocal recovery draft");
    await page.getByRole("button", { name: "Save reviewed draft", exact: true }).click(); await saved(page);
    assert.equal(store.getNote(first.id)?.content, "Another remote edit\nLocal recovery draft");
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("cc.notes.draft.")).length), 0);
    await page.locator("#knowledge-drafts-enabled").uncheck();
    assert.equal(await page.evaluate(() => localStorage.getItem("cc.notes.recovery")), null);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test("browser recovery expires old copies, isolates other drafts, reports quota errors, and can be cleared", { timeout: 60_000 }, async () => {
  const h = await setup(), { page, first, failures } = h;
  try {
    await page.goto(`http://notes.test/notes?note=${first.id}`); await ready(page);
    await page.evaluate(() => {
      const body = { title: "Other draft", content: "Keep this unrelated recovery copy", tags: [], spaceId: null, sourceUrl: null };
      localStorage.setItem("cc.notes.recovery", "enabled");
      localStorage.setItem("cc.notes.draft.other", JSON.stringify({ noteId: null, version: 0, savedAt: Date.now(), body }));
      localStorage.setItem("cc.notes.draft.expired", JSON.stringify({ noteId: null, version: 0, savedAt: Date.now() - 8 * 86400000, body }));
    });
    await page.reload(); await ready(page);
    assert.equal(await page.evaluate(() => localStorage.getItem("cc.notes.draft.expired")), null);
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.locator("#knowledge-body").fill("A successfully saved edit"); await saved(page);
    assert.ok(await page.evaluate(() => localStorage.getItem("cc.notes.draft.other")), "saving one document does not remove another draft");
    failures.write = true;
    await page.locator(".notes-recovery summary").first().click();
    await page.evaluate(() => {
      const body = { title: "Full recovery list", content: "Unrelated draft", tags: [] };
      for (let i = 0; i < 19; i++) localStorage.setItem(`cc.notes.draft.limit-${i}`, JSON.stringify({ noteId: null, version: 0, savedAt: Date.now(), body }));
    });
    await page.locator("#knowledge-body").fill("Keep this when twenty drafts already exist");
    await page.waitForFunction(() => document.querySelector("#knowledge-draft-status")?.textContent?.includes("limit reached"));
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("cc.notes.draft.")).length), 20);
    await page.evaluate(() => {
      for (let i = 0; i < 19; i++) localStorage.removeItem(`cc.notes.draft.limit-${i}`);
      const body = { title: "Large recovery draft", content: "x".repeat(200000), tags: [] };
      for (let i = 0; i < 10; i++) localStorage.setItem(`cc.notes.draft.limit-${i}`, JSON.stringify({ noteId: null, version: 0, savedAt: Date.now(), body }));
    });
    await page.locator("#knowledge-body").fill("Keep this when two megabytes of drafts already exist");
    await page.waitForFunction(() => document.querySelector("#knowledge-draft-status")?.textContent?.includes("limit reached"));
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("cc.notes.draft.")).length), 11);
    await page.evaluate(() => {
      for (let i = 0; i < 10; i++) localStorage.removeItem(`cc.notes.draft.limit-${i}`);
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key: string, value: string) {
        if (key.startsWith("cc.notes.draft.")) throw new DOMException("Quota exceeded", "QuotaExceededError");
        original.call(this, key, value);
      };
    });
    failures.write = true;
    await page.locator("#knowledge-body").fill("Keep text even when recovery and server storage fail");
    await page.waitForFunction(() => document.querySelector("#knowledge-draft-status")?.textContent?.includes("Quota"));
    assert.equal(await page.locator("#knowledge-body").inputValue(), "Keep text even when recovery and server storage fail");
    await page.locator("#knowledge-drafts-enabled").uncheck();
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("cc.notes.draft.")).length), 0);
    failures.write = false;
    await page.getByRole("button", { name: "Save note", exact: true }).click(); await saved(page);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});
