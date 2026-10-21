import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";
import type { KnowledgeNote } from "../src/notes/store";
import { renderNoteMarkdown } from "../src/notes/markdown";
import { notesPage } from "../src/ui/notes-page";

const note = (id: string, title: string, content: string): KnowledgeNote => ({
  id, title, content, tags: [], spaceId: null, sourceUrl: null,
  createdAt: "2026-10-18T12:00:00Z", updatedAt: "2026-10-18T12:00:00Z",
});

async function until(page: Page, selector: string, text: string) {
  await page.waitForFunction(({ selector, text }) =>
    document.querySelector(selector)?.textContent?.includes(text), { selector, text });
}

test("Notes writing workflow preserves drafts, serializes autosaves, and supports responsive views", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
    assert.equal(await page.locator("#knowledge-body").inputValue(), notes[0]!.content);
    await until(page, "#knowledge-preview", "Original text");

    await page.locator("#knowledge-body").fill("# Updated\n\n**Readable** text");
    await until(page, "#knowledge-preview strong", "Readable");
    await until(page, "#knowledge-save-status", "Saved to your library");
    assert.equal(notes[0]!.content, "# Updated\n\n**Readable** text");
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
    await page.locator(".notes-note").filter({ has: page.locator("strong", { hasText: "Second" }) }).click();
    await page.waitForFunction(() => (document.querySelector("#knowledge-title") as HTMLInputElement).value === "Second");

    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.locator("#knowledge-title").fill("New idea");
    await page.locator("#knowledge-body").fill("Created automatically");
    await until(page, "#knowledge-save-status", "Saved to your library");
    assert.equal(notes.length, 3);
    assert.equal(notes[2]!.content, "Created automatically");
    await page.reload();
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
