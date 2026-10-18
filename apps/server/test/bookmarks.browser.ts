import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { BookmarksStore } from "../src/bookmarks/store";
import { bookmarksPage } from "../src/ui/bookmarks-page";

async function until(page: Page, selector: string, text: string) {
  await page.waitForFunction(({ selector, text }) =>
    document.querySelector(selector)?.textContent?.includes(text), { selector, text });
}

test("Bookmarks launchpad creates, edits, imports, searches, and persists layout", { timeout: 30_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-bookmarks-browser-"));
  const browser = await chromium.launch();
  try {
    const store = await BookmarksStore.open(dir);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    const externalRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const hostname = new URL(request.url()).hostname;
      if (!["bookmarks.test", "fonts.googleapis.com", "fonts.gstatic.com"].includes(hostname)) externalRequests.push(request.url());
    });
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
    let failWrites = false;
    await page.route("http://bookmarks.test/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/bookmarks") return route.fulfill({ contentType: "text/html", body: bookmarksPage() });
      if (path === "/api/bookmarks") return route.fulfill({ json: store.list() });
      if (!path.startsWith("/api/bookmarks/")) return route.fulfill({ json: {} });
      if (failWrites) return route.fulfill({ status: 500, json: { error: "Disk unavailable" } });
      try {
        const input = request.postDataJSON();
        let result: unknown = { ok: true };
        if (path.endsWith("/groups")) {
          if (request.method() === "POST") result = { group: await store.createGroup(input) };
          if (request.method() === "PATCH") await store.updateGroup(input);
          if (request.method() === "DELETE") await store.deleteGroup(input);
        } else if (path.endsWith("/items")) {
          if (request.method() === "POST" || request.method() === "PUT") result = { bookmark: await store.saveBookmark(input, request.method() === "PUT") };
          if (request.method() === "PATCH") await store.moveBookmark(input);
          if (request.method() === "DELETE") await store.deleteBookmark(input);
        } else if (path.endsWith("/import")) result = await store.import(input);
        else if (path.endsWith("/preferences")) await store.preferences(input);
        return route.fulfill({ json: result });
      } catch (error) {
        return route.fulfill({ status: 400, json: { error: error instanceof Error ? error.message : String(error) } });
      }
    });
    await page.goto("http://bookmarks.test/bookmarks");
    await until(page, "#bookmark-groups", "Your internet, organized.");
    await page.waitForFunction(() => !(document.querySelector("#bookmark-new-group") as HTMLButtonElement).disabled);
    page.once("dialog", (dialog) => dialog.accept("Work"));
    await page.getByRole("button", { name: "New group", exact: true }).click();
    await until(page, "#bookmark-status", "Group created.");
    await page.getByRole("button", { name: "Add bookmark", exact: true }).click();
    await page.locator("#bookmark-title").fill("Example docs");
    await page.locator("#bookmark-url").fill("https://example.com/docs");
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await until(page, "#bookmark-status", "Bookmark saved.");
    const link = page.getByRole("link", { name: /Example docs/ });
    assert.equal(await link.getAttribute("href"), "https://example.com/docs");
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.match((await link.getAttribute("rel"))!, /noopener noreferrer/);

    await page.getByLabel("Manage bookmark Example docs").click();
    await page.getByRole("button", { name: "Edit or move" }).click();
    await page.locator("#bookmark-title").fill("Updated docs");
    failWrites = true;
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await until(page, "#bookmark-form-error", "Disk unavailable");
    assert.equal(await page.locator("#bookmark-dialog").isVisible(), true);
    assert.equal(await page.locator("#bookmark-title").inputValue(), "Updated docs");
    failWrites = false;
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await page.waitForFunction(() => !(document.querySelector("#bookmark-dialog") as HTMLDialogElement).open);
    assert.equal(store.list().bookmarks[0]!.title, "Updated docs");

    await page.getByText("Layout & files", { exact: true }).click();
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1><DL><p>
<DT><H3>Work</H3><DL><p>
<DT><A HREF="https://example.com/docs">Duplicate docs</A>
<DT><H3>Research</H3><DL><p><DT><A HREF="https://research.example/one">Research &amp; notes</A></DL><p>
</DL><p>
<DT><H3>Personal</H3><DL><p>
<DT><A HREF="https://personal.example/">Personal site</A>
<DT><A HREF="javascript:alert(1)">Unsafe bookmark</A>
</DL><p></DL><p>`;
    await page.locator("#bookmark-import").setInputFiles({
      name: "bookmarks.html", mimeType: "text/html", buffer: Buffer.from(html),
    });
    await until(page, "#bookmark-status", "Imported 2 bookmarks; 1 duplicates skipped; 1 unsupported URLs skipped.");
    assert.deepEqual(store.list().groups.map((group) => group.name), ["Work", "Work / Research", "Personal"]);
    assert.equal(store.list().bookmarks.length, 3);
    await page.locator("#bookmark-search").fill("research");
    assert.equal(await page.locator(".bookmark-group").count(), 1);
    await until(page, "#bookmark-groups", "Research & notes");
    await page.locator("#bookmark-search").fill("missing link");
    await until(page, "#bookmark-groups", "No matching bookmarks");
    await page.locator("#bookmark-search").fill("");

    await page.locator("#bookmark-density").selectOption("compact");
    await until(page, "#bookmark-status", "Layout saved.");
    await page.waitForFunction(() => !(document.querySelector("#bookmark-columns") as HTMLSelectElement).disabled);
    await page.locator("#bookmark-columns").selectOption("4");
    await page.waitForFunction(() => document.querySelector("#bookmark-groups")?.getAttribute("style")?.includes("4"));
    await page.reload();
    await page.waitForFunction(() => document.querySelector(".bookmark-page")?.getAttribute("data-density") === "compact");
    assert.equal(store.list().preferences.columns, 4);
    const columns = await page.locator(".bookmark-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    assert.equal(columns, 4);

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.getByText("Layout & files", { exact: true }).click();
    await page.locator("#bookmark-import").setInputFiles({
      name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{broken"),
    });
    await page.waitForFunction(() => document.querySelector("#bookmark-status")?.classList.contains("bad"));
    assert.equal(store.list().bookmarks.length, 3);
    await page.locator("#bookmark-import").setInputFiles({
      name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(store.list())),
    });
    await until(page, "#bookmark-status", "Imported 0 bookmarks; 3 duplicates skipped.");
    assert.deepEqual((await BookmarksStore.open(dir)).list(), store.list());
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});
