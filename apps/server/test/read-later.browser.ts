import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { sourcesPage, sourceDetailPage } from "../src/ui/sources-page";
import { boardPage } from "../src/ui/board-page";
import { winsPage } from "../src/ui/wins-page";
import { assistantPage } from "../src/ui/assistant-page";
import { activityPage } from "../src/ui/activity-page";
import { agentQueuePage } from "../src/ui/agent-queue-page";
import type { KnowledgeSource, KnowledgeSpace } from "../src/notes/store";

test("Read Later and Agent: compact density, folders, tags, pagination, and working sections", async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined });
  const at = "2026-10-21T12:00:00Z";
  const spaces: KnowledgeSpace[] = [{ id: "work", name: "Research", description: "", instructions: "", references: [], createdAt: at, updatedAt: at }];
  const sources: KnowledgeSource[] = Array.from({ length: 123 }, (_, index) => ({
    id: String(index), title: `Article ${String(index).padStart(3, "0")} about thoughtful tools`,
    url: `https://example.com/articles/${index}`, excerpt: "Captured article text for reading and summarization.",
    tags: [index % 2 ? "design" : "research"], spaceId: index % 2 ? "work" : null,
    summary: index % 2 ? "A concise summary of a useful article." : undefined,
    archivedAt: null, createdAt: at, updatedAt: at,
  }));
  let failSummary = false;
  let queueDone = false;
  const errors: string[] = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("http://app.test/**", async (route) => {
    const request = route.request(), url = new URL(request.url());
    const body = request.method() === "POST" || request.method() === "PUT" ? request.postDataJSON() : null;
    if (url.pathname === "/api/settings") return route.fulfill({ json: { settings: { viewPreferences: {} } } });
    if (url.pathname === "/api/knowledge") return route.fulfill({ json: { sources, spaces, notes: [] } });
    if (url.pathname === "/api/knowledge/spaces") {
      const space = { ...spaces[0]!, id: "new", name: body.name };
      spaces.push(space);
      return route.fulfill({ json: { space } });
    }
    if (url.pathname.startsWith("/api/knowledge/sources/")) {
      const source = sources.find((item) => url.pathname.endsWith("/" + item.id))!;
      Object.assign(source, body);
      return route.fulfill({ json: { source } });
    }
    if (url.pathname.endsWith("/summarize")) {
      if (failSummary) return route.fulfill({ status: 429, json: { error: "Summary limit reached." } });
      const source = sources.find((item) => url.pathname.includes("/" + item.id + "/"))!;
      source.summary = "New summary";
      return route.fulfill({ json: { source } });
    }
    if (url.pathname === "/api/read-later") {
      const source = { ...sources[0]!, ...body, id: "saved", summary: body.summarize ? "Saved summary" : undefined };
      sources.push(source);
      return route.fulfill({ json: { source, duplicate: false } });
    }
    if (url.pathname === "/api/knowledge/ask") {
      assert.equal(body.sourceId, "0");
      return route.fulfill({ json: { answer: "An answer from your article [1].", citations: [{ number: 1, title: sources[0]!.title, url: sources[0]!.url }] } });
    }
    if (url.pathname === "/api/hobie/queue") return route.fulfill({ json: { tasks: queueDone ? [] : [{ id: "task", title: "Read the research", body: "Review the saved material", status: "pending", clientId: "test" }] } });
    if (url.pathname === "/api/hobie/queue/task/done") {
      queueDone = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname === "/api/board/cards") return route.fulfill({ json: { cards: [] } });
    if (url.pathname === "/api/wins") return route.fulfill({ json: { weeks: [] } });
    if (url.pathname === "/api/activity/updates") return route.fulfill({ json: { updates: [] } });
    if (url.pathname === "/library") return route.fulfill({ contentType: "text/html", body: sourcesPage() });
    if (url.pathname === "/library/0") return route.fulfill({ contentType: "text/html", body: sourceDetailPage() });
    if (url.pathname === "/agent") {
      const pages = { board: boardPage, queue: agentQueuePage, wins: winsPage, assistant: assistantPage, activity: activityPage };
      return route.fulfill({ contentType: "text/html", body: pages[(url.searchParams.get("view") || "board") as keyof typeof pages]() });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  async function screenshot(page: Page, name: string) {
    if (!process.env.SCREENSHOT_DIR) return;
    await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, name), fullPage: false });
  }
  try {
    await page.goto("http://app.test/library");
    await page.waitForFunction(() => document.querySelectorAll(".library-item").length === 50);
    assert.equal(await page.locator("h1").textContent(), "Read Later");
    assert.equal(await page.locator('.sidebar-nav a[href="/agent"]').count(), 1);
    assert.equal(await page.locator("#source-compact-view").getAttribute("aria-pressed"), "true");
    const heights = await page.locator(".library-item").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
    assert.ok(heights.every((height) => height <= 80), `Compact rows too tall: ${Math.max(...heights)}`);
    await screenshot(page, "read-later-compact-desktop.png");
    await page.locator("#source-next").click();
    assert.match(page.url(), /page=2/);
    assert.equal(await page.locator(".library-item").count(), 50);
    await page.locator("#source-next").click();
    assert.equal(await page.locator(".library-item").count(), 23);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll(".library-item").length === 23);
    await page.getByRole("button", { name: /^Research 61$/ }).click();
    assert.equal(await page.locator(".library-item").count(), 50);
    assert.equal(await page.locator("#source-page").textContent(), "1–50 of 61");
    await page.getByRole("button", { name: /^#research 62$/ }).click();
    assert.equal(await page.locator(".library-item").count(), 0);
    await page.locator('#tag-list button').first().click();
    await page.locator("#folder-form").evaluate((form: HTMLFormElement) => { (form.parentElement as HTMLDetailsElement).open = true; });
    await page.locator("#folder-name").fill("Reading");
    await page.locator("#folder-form button").click();
    await page.waitForFunction(() => document.querySelector("#workspace-status")?.textContent?.includes("Folder created"));
    assert.equal(await page.locator("#source-space-filter").inputValue(), "new");
    await page.locator("#source-add").click();
    assert.equal(await page.locator("#capture-space").inputValue(), "new");
    await page.locator("#capture-url").fill("https://example.com/saved");
    await page.locator("#capture-tags").fill("reading, useful");
    await page.getByRole("button", { name: "Save & summarize", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#workspace-status")?.textContent === "Link saved.");
    assert.equal(sources.at(-1)!.spaceId, "new");
    assert.deepEqual(sources.at(-1)!.tags, ["reading", "useful"]);
    await page.goto("http://app.test/library");
    await page.waitForSelector(".library-item");
    await page.getByRole("button", { name: "Summarize " + sources[0]!.title, exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#workspace-status")?.textContent === "Summary ready.");
    failSummary = true;
    await page.getByRole("button", { name: "Summarize " + sources[2]!.title, exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#workspace-status")?.textContent === "Summary limit reached.");
    failSummary = false;
    await page.locator('summary[aria-label="Organize ' + sources[0]!.title + '"]').click();
    await page.selectOption("#folder-0", "work");
    await page.locator("#tags-0").fill("updated");
    await page.locator(".reading-organize[open] button").click();
    await page.waitForFunction(() => document.querySelector("#workspace-status")?.textContent === "Folder and tags saved.");
    assert.equal(sources[0]!.summary, "New summary");
    assert.equal(sources[0]!.spaceId, "work");
    await page.locator("#source-card-view").click();
    assert.equal(await page.locator(".library-cards").count(), 1);
    await page.locator("#source-list-view").click();
    assert.equal(await page.locator(".reading-compact").count(), 0);
    await page.locator("#source-compact-view").click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForSelector(".library-item");
    assert.equal(await page.locator("#organizer-panel").getAttribute("open"), null);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile overflow");
    await screenshot(page, "read-later-compact-mobile.png");
    await page.locator("#organizer-panel>summary").click();
    await page.getByRole("button", { name: /^Research / }).click();
    assert.equal(await page.locator("#source-space-filter").inputValue(), "work");
    await page.locator("#organizer-panel>summary").click();
    await page.locator("#theme-toggle").click();
    await screenshot(page, "read-later-compact-mobile-dark.png");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "dark mobile overflow");
    await page.goto("http://app.test/library/0");
    await page.waitForSelector("#source-title");
    await page.locator("#source-ask").click();
    await page.waitForFunction(() => (document.querySelector("#ask-scope") as HTMLSelectElement)?.value === "source:0");
    await page.locator("#ask-question").fill("What matters here?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#ask-answer")?.textContent?.includes("An answer"));
    for (const view of ["board", "queue", "wins", "assistant", "activity"]) {
      await page.locator(`.agent-tabs a[href="/agent?view=${view}"]`).click();
      await page.waitForSelector(`.agent-tabs a[href="/agent?view=${view}"][aria-current=page]`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${view} mobile overflow`);
    }
    await page.goto("http://app.test/agent?view=queue");
    await page.waitForSelector("#agent-queue article");
    await screenshot(page, "agent-queue-mobile.png");
    await page.getByRole("button", { name: "Mark done: Read the research" }).click();
    await page.waitForSelector("#agent-queue .ui-empty");
    await page.setViewportSize({ width: 1440, height: 1000 });
    queueDone = false;
    await page.locator("#queue-refresh").click();
    await page.waitForSelector("#agent-queue article");
    await screenshot(page, "agent-queue-desktop.png");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
