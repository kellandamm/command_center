import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { loadConfig } from "../src/config";
import { createApp } from "../src/http";
import { SettingsStore } from "../src/settings";
import { NotesStore } from "../src/notes/store";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { CalendarWorkspace } from "../src/calendar/workspace";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

test("native capture, Notes/voice links, Focus and Shutdown work on desktop/mobile in workspace TZ", { timeout: 180_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-task-browser-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: "t".repeat(32), OWNER_EMAILS: "owner@example.com", TZ: "Asia/Tokyo", LLM_BASE_URL: "https://llm.example/v1", LLM_API_KEY: "test", LLM_MODEL: "test" });
  const integration = await openIntegrationStores(dir, cfg), notes = await NotesStore.open(dir);
  const calendar = await CalendarWorkspace.open(cfg, undefined, { notes, board: integration.board });
  const settings = new SettingsStore(dir); await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  await calendar.create({ kind: "native", name: "Local" });
  const server = createApp({ cfg, ...integration, notes, calendar, settings, dailyBriefing, auth: async () => ({ ok: true, who: "owner@example.com", owner: true }) });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://llm.example/")) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: String(JSON.parse(String(init?.body)).messages.at(-1)?.content).includes("appointment") ? [{ kind: "event", title: "Tokyo appointment", start: "2030-06-10T09:00", durationMinutes: 60 }] : [{ kind: "task", title: "Selected native task", due: "2030-06-10" }] }) } }] }));
    if (!String(input).startsWith(base)) throw new Error("Unexpected outbound request in browser test");
    return original(input, init);
  };
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL });
  try {
    for (const width of [1440, 390]) {
      const note = await notes.createNote({ title: `Capture ${width}`, content: "Keep this line\nReview project tomorrow\nFooter" });
      await integration.voiceCaptures.create("Voice task", [{ version: 2, source: "board", timezone: cfg.tz, operationId: `voice-browser-${width}`, kind: "task", title: `Voice ${width}`, due: "2030-06-10" }]);
      const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: "America/Los_Angeles", extraHTTPHeaders: { "x-ah": "1" } });
      try {
        const page = await context.newPage(), errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
        await page.goto(`${base}/notes?note=${note.id}`);
        await page.waitForFunction(() => (document.querySelector("#knowledge-title") as HTMLInputElement)?.value.startsWith("Capture"));
        await page.getByRole("button", { name: "Source", exact: true }).click();
        await page.locator("#knowledge-body").evaluate((element: HTMLTextAreaElement) => { element.focus(); const start = element.value.indexOf("Review"); element.setSelectionRange(start, start + "Review project tomorrow".length); element.dispatchEvent(new Event("select")); });
        await page.locator("#knowledge-line-quick-add").click();
        await page.waitForSelector("#notes-quick-add .quick-add-preview:not([hidden])");
        assert.match(await page.locator("#notes-quick-add .quick-add-preview").innerText(), /Native Board task/);
        assert.match(await page.locator("#notes-quick-add .quick-add-preview").innerText(), /Asia\/Tokyo/);
        const before = integration.board.list().length;
        await page.locator("#notes-quick-add").getByRole("button", { name: "Confirm", exact: true }).click();
        await page.waitForFunction(() => (document.querySelector("#knowledge-body") as HTMLTextAreaElement).value.includes("[native task]"));
        assert.equal(integration.board.list().length, before + 1);
        const task = integration.board.list().filter((card) => card.title === "Selected native task").at(-1)!;
        const linked = await page.locator("#knowledge-body").inputValue();
        assert.ok(linked.includes(`/calendar/event?task=${task.id}`));
        assert.ok(linked.startsWith("Keep this line\n"));
        assert.ok(linked.endsWith("\nFooter"));
        await page.goto(`${base}/calendar/event?task=${task.id}`);
        await page.waitForSelector("#task-planning:not([hidden])");
        assert.match(await page.locator("#task-identity").innerText(), new RegExp(task.id));
        await page.goto(base);
        await page.locator("#voice-inbox").getByRole("button", { name: "Review", exact: true }).first().click();
        await page.waitForSelector("#dashboard-quick-add .quick-add-preview:not([hidden])");
        assert.match(await page.locator("#dashboard-quick-add .quick-add-preview").innerText(), /Asia\/Tokyo/);
        await page.locator("#dashboard-quick-add").getByRole("button", { name: "Confirm", exact: true }).click();
        const voiceLink = page.locator("#dashboard-quick-add .quick-add-status a").first();
        await voiceLink.waitFor();
        const voiceTask = integration.board.list().find((card) => card.title === `Voice ${width}`)!;
        assert.equal(await voiceLink.getAttribute("href"), `/calendar/event?task=${voiceTask.id}`);
        await page.reload();
        await page.waitForSelector(`#focus-task-select option[value="board:${task.id}"]`, { state: "attached" });
        const expand = page.getByRole("button", { name: "Expand Focus panel", exact: true });
        if (await expand.count()) await expand.click();
        await page.locator("#focus-task-select").selectOption(`board:${task.id}`);
        await page.locator("#focus-start").click();
        await page.waitForTimeout(1100);
        const recorded = page.waitForResponse((response) => response.url().endsWith("/api/focus/sessions"));
        await page.locator("#focus-stop").click();
        await recorded;
        assert.equal(integration.focusSessions.list()[0]?.taskSource, "board");
        assert.equal(integration.board.get(task.id)?.column, "Backlog");
        await page.locator("#dashboard-quick-add .quick-add-input").fill("appointment tomorrow morning");
        await page.locator("#dashboard-quick-add .quick-add-input").press("Enter");
        await page.waitForSelector("#dashboard-quick-add .quick-add-preview:not([hidden])");
        assert.match(await page.locator("#dashboard-quick-add .quick-add-preview").innerText(), /Start \(local Asia\/Tokyo/);
        const eventCount = calendar.store.events().length;
        assert.equal(eventCount, width === 1440 ? 0 : 1, "event preview must be write-free");
        await page.locator("#dashboard-quick-add").getByRole("button", { name: "Confirm", exact: true }).click();
        await page.locator("#dashboard-quick-add .quick-add-status a").waitFor();
        assert.equal(calendar.store.events().length, eventCount + 1);
        assert.equal(calendar.store.events().at(-1)?.start, "2030-06-10T00:00:00.000Z");
        await page.goto(base + "/briefing");
        await page.locator("#db-mode-shutdown").click();
        await page.waitForFunction(() => document.querySelector("#db-shutdown-meta")?.textContent?.includes("Asia/Tokyo"));
        assert.equal(errors.length, 0, errors.join("\n"));
      } finally { await context.close(); }
    }
  } finally {
    globalThis.fetch = original;
    await browser.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
