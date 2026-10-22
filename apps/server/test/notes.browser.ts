import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";
import type { KnowledgeNote } from "../src/notes/store";
import { renderNoteMarkdown } from "../src/notes/markdown";
import { notesPage } from "../src/ui/notes-page";
import { readFile } from "node:fs/promises";

const note = (id: string, title: string, content: string): KnowledgeNote => ({
  id, title, content, tags: [], spaceId: null, sourceUrl: null,
  createdAt: "2026-10-18T12:00:00Z", updatedAt: "2026-10-18T12:00:00Z",
});

test("Notes open deep links in directly editable Write mode and preserve unsupported source", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const notes = [note("first", "First", "First note"), note("second", "Second", "## Plan\n\n**Formatted** writing with [[First]].\n\n- [ ] Follow up\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```")];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://notes.test/**", async (route) => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === "/notes") return route.fulfill({ contentType: "text/html", body: notesPage() });
      if (path === "/assets/notes-editor.js") return route.fulfill({ contentType: "text/javascript", body: await readFile(new URL("../dist/notes-editor.js", import.meta.url), "utf8") });
      if (path === "/api/knowledge") return route.fulfill({ json: { notes, sources: [], spaces: [] } });
      if (path === "/api/knowledge/graph") return route.fulfill({ json: { nodes: [], edges: [] } });
      if (path === "/api/knowledge/preview") return route.fulfill({ json: { html: renderNoteMarkdown(req.postDataJSON().content) } });
      if (path === "/api/knowledge/notes/second" && req.method() === "PUT") {
        Object.assign(notes[1]!, req.postDataJSON(), { updatedAt: new Date().toISOString() });
        return route.fulfill({ json: { note: notes[1] } });
      }
      return route.fulfill({ json: {} });
    });
    await page.goto("http://notes.test/notes?note=second");
    await page.waitForFunction(() => !(document.querySelector("#knowledge-fields") as HTMLFieldSetElement).disabled);
    assert.equal(await page.locator("#knowledge-title").inputValue(), "Second");
    const rich = page.getByRole("textbox", { name: "Note document", exact: true });
    await rich.waitFor();
    assert.equal(await rich.locator("strong").innerText(), "Formatted");
    assert.equal(await rich.locator("table").count(), 1);
    assert.equal(await rich.locator('input[type="checkbox"]').count(), 1);
    assert.match(await rich.innerText(), /\[\[First\]\]/);
    await rich.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Added directly");
    await until(page, "#knowledge-save-status", "Saved to your library");
    assert.match(notes[1]!.content, /Added directly/);
    assert.match(notes[1]!.content, /\[\[First\]\]/);
    assert.match(notes[1]!.content, /const x = 1/);
    assert.match(notes[1]!.content, /\[ \]/);
    await page.locator(".notes-note").filter({ has: page.locator("strong", { hasText: /^First$/ }) }).click();
    await page.waitForFunction(() => (document.querySelector("#knowledge-title") as HTMLInputElement).value === "First");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert.equal(await rich.innerText(), "First note");
    await page.locator(".notes-note").filter({ has: page.locator("strong", { hasText: /^Second$/ }) }).click();
    await page.waitForFunction(() => (document.querySelector("#knowledge-title") as HTMLInputElement).value === "Second");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.locator("#knowledge-body").fill("![Original image](https://example.com/picture.png)");
    await page.getByRole("button", { name: "Write", exact: true }).click();
    await until(page, "#knowledge-editor-warning", "cannot preserve");
    assert.equal(await page.locator("#knowledge-body").isVisible(), true);
    assert.equal(await page.locator("#knowledge-body").inputValue(), "![Original image](https://example.com/picture.png)");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    await until(page, "#knowledge-save-status", "Saved to your library");
  } finally { await browser.close(); }
});

async function until(page: Page, selector: string, text: string) {
  await page.waitForFunction(({ selector, text }) =>
    document.querySelector(selector)?.textContent?.includes(text), { selector, text });
}

test("Notes writing workflow preserves drafts, serializes autosaves, and supports responsive views", { timeout: 90_000 }, async (t) => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10_000);
    t.diagnostic("Notes browser ready");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const notes = [note("first", "First", "# First\n\nOriginal text"), note("second", "Second", "Second note")];
    let failWrites = false;
    let delayWrites = false;
    let releaseWrite: (() => void) | undefined;
    const writes: Array<{ id: string; content: string }> = [];
    await page.route("http://notes.test/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/assets/notes-editor.js") return route.fulfill({ contentType: "text/javascript", body: await readFile(new URL("../dist/notes-editor.js", import.meta.url), "utf8") });
      if (path === "/notes") return route.fulfill({ contentType: "text/html", body: notesPage() });
      if (path === "/api/knowledge") return route.fulfill({ json: { notes, sources: [], spaces: [] } });
      if (path === "/api/knowledge/graph") return route.fulfill({ json: { nodes: [], edges: [] } });
      if (path === "/api/knowledge/preview") {
        return route.fulfill({ json: { html: renderNoteMarkdown(request.postDataJSON().content) } });
      }
      if (path.startsWith("/api/knowledge/notes")) {
        if (request.method() === "DELETE") {
          const index = notes.findIndex((item) => item.id === path.split("/")[4]);
          if (index >= 0) notes.splice(index, 1);
          return route.fulfill({ json: { ok: true } });
        }
        if (failWrites) return route.fulfill({ status: 500, json: { error: "Disk unavailable" } });
        if (delayWrites) {
          delayWrites = false;
          await new Promise<void>((resolve) => { releaseWrite = resolve; });
        }
        const id = path.split("/")[4];
        const body = request.postDataJSON();
        let saved = notes.find((item) => item.id === id);
        if (!saved) {
          saved = note(`new-${notes.length}`, body.title, body.content);
          notes.push(saved);
        }
        Object.assign(saved, body, { updatedAt: new Date().toISOString() });
        writes.push({ id: saved.id, content: saved.content });
        return route.fulfill({ json: { note: saved } });
      }
      return route.fulfill({ json: {} });
    });
    await page.goto("http://notes.test/notes");
    await page.waitForFunction(() => !(document.querySelector("#knowledge-fields") as HTMLFieldSetElement).disabled);
    await page.getByRole("button", { name: "Source", exact: true }).click();
    t.diagnostic("Source editing opened");
    assert.equal(await page.locator("#knowledge-body").inputValue(), notes[0]!.content);
    await until(page, "#knowledge-preview", "Original text");

    await page.locator("#knowledge-body").fill("# Updated\n\n**Readable** text");
    await until(page, "#knowledge-preview strong", "Readable");
    await until(page, "#knowledge-save-status", "Saved to your library");
    assert.equal(notes[0]!.content, "# Updated\n\n**Readable** text");
    t.diagnostic("Initial autosave complete");
    assert.equal(await page.locator("#knowledge-body").inputValue(), notes[0]!.content);

    await page.getByRole("button", { name: "Preview", exact: true }).click();
    assert.equal(await page.locator("#knowledge-body").isVisible(), false);
    assert.equal(await page.locator("#knowledge-formatting").isVisible(), false);
    await page.getByRole("button", { name: "Source", exact: true }).click();
    assert.equal(await page.locator("#knowledge-preview").isVisible(), false);
    await page.getByRole("button", { name: "Focus mode", exact: true }).click();
    assert.equal(await page.locator(".sidebar").isVisible(), false);
    assert.equal(await page.locator(".notes-library").isVisible(), false);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".notes-library").isVisible(), true);

    await page.locator("#knowledge-body").fill("selected");
    await page.locator("#knowledge-body").selectText();
    await page.getByRole("button", { name: "B", exact: true }).click();
    assert.equal(await page.locator("#knowledge-body").inputValue(), "**selected**");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await until(page, "#knowledge-save-status", "Saved to your library");

    delayWrites = true;
    await page.locator("#knowledge-body").fill("First save snapshot");
    await page.waitForFunction(() => document.querySelector("#knowledge-save-status")?.textContent === "Saving…");
    while (!releaseWrite) await new Promise((resolve) => setTimeout(resolve, 10));
    await page.locator("#knowledge-body").fill("Newer edit during save");
    releaseWrite();
    await until(page, "#knowledge-save-status", "Saved to your library");
    assert.equal(notes[0]!.content, "Newer edit during save");
    assert.equal(await page.locator("#knowledge-body").inputValue(), "Newer edit during save");
    assert.deepEqual(writes.slice(-2).map((write) => write.content), ["First save snapshot", "Newer edit during save"]);
    t.diagnostic("Concurrent autosave complete");

    failWrites = true;
    await page.locator("#knowledge-body").fill("Keep this draft after failure");
    await page.locator(".notes-note").filter({ has: page.locator("strong", { hasText: "Second" }) }).click();
    await until(page, "#knowledge-save-status", "Not saved:");
    assert.equal(await page.locator("#knowledge-title").inputValue(), "First");
    assert.equal(await page.locator("#knowledge-body").inputValue(), "Keep this draft after failure");
    assert.equal(await page.locator("#knowledge-fields").isDisabled(), false);
    failWrites = false;
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await until(page, "#knowledge-save-status", "Saved to your library");
    assert.equal(notes[0]!.content, "Keep this draft after failure");
    t.diagnostic("Failed-save recovery complete");
    await page.locator(".notes-note").filter({ has: page.locator("strong", { hasText: "Second" }) }).click();
    await page.waitForFunction(() => (document.querySelector("#knowledge-title") as HTMLInputElement).value === "Second");

    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.locator("#knowledge-title").fill("New idea");
    await page.locator("#knowledge-body").fill("Created automatically");
    await until(page, "#knowledge-save-status", "Saved to your library");
    assert.equal(notes.length, 3);
    assert.equal(notes[2]!.content, "Created automatically");
    await page.reload();
    t.diagnostic("New note reload complete");
    await page.waitForFunction(() => !(document.querySelector("#knowledge-fields") as HTMLFieldSetElement).disabled);
    await page.locator(".notes-note").filter({ has: page.locator("strong", { hasText: "New idea" }) }).click();
    assert.equal(await page.locator("#knowledge-body").inputValue(), "Created automatically");

    await page.getByRole("button", { name: "Split", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await until(page, "#knowledge-preview", "Created automatically");
    assert.equal(await page.locator("#knowledge-body").isVisible(), true);
    assert.equal(await page.locator("#knowledge-preview").isVisible(), true);
    const overflow = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll("body *")].filter((element) =>
        element.getBoundingClientRect().right > window.innerWidth + 1,
      ).map((element) => `${element.tagName}.${element.className}#${element.id}`),
    }));
    assert.ok(overflow.scrollWidth <= overflow.width, JSON.stringify(overflow));

    await page.locator(".notes-properties summary").click();
    await page.locator("#knowledge-note-url").fill("not a URL");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await until(page, "#knowledge-save-status", "Not saved:");
    assert.equal(notes[2]!.sourceUrl, null);
    await page.locator("#knowledge-note-url").fill("https://example.com");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await until(page, "#knowledge-save-status", "Saved to your library");
    assert.equal(notes[2]!.sourceUrl, "https://example.com");

    await page.locator("#knowledge-body").fill("Unsaved before deleting");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete note", exact: true }).click();
    await until(page, "#knowledge-status", "Note deleted.");
    assert.equal(notes.length, 2);
    assert.equal(notes.some((item) => item.title === "New idea"), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
