import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { BriefingService } from "../src/briefing/service";
import { AiSecurityService } from "../src/ai-security/service";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig, todoistConfigured } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { NewsPrefsStore } from "../src/feeds/news-prefs";
import { FeedsStore } from "../src/feeds/store";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { openIntegrationStores } from "./helpers";
import { partitionTodayAndOverdue, type TodoistTask } from "../src/todoist/client";

const TOKEN = "t".repeat(32);

function task(id: string, content: string, dueDate: string | null, priority = 1): TodoistTask {
  return {
    id,
    content,
    description: "",
    priority,
    due: dueDate ? { date: dueDate, string: dueDate, datetime: null } : null,
    url: "https://todoist.com/showTask?id=" + id,
  };
}

test("todoist: partition overdue and today by configured zone", () => {
  const now = new Date("2026-10-14T15:00:00Z");
  const tz = "UTC";
  const { overdue, today } = partitionTodayAndOverdue(
    [task("1", "old", "2026-10-13"), task("2", "now", "2026-10-14"), task("3", "later", "2026-10-15"), task("4", "nodue", null)],
    now,
    tz,
  );
  assert.deepEqual(overdue.map((t) => t.id), ["1"]);
  assert.deepEqual(today.map((t) => t.id), ["2"]);
});

test("todoist: API returns unconfigured state without token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "1" });
  assert.equal(todoistConfigured(cfg), false);
  const settings = new SettingsStore(dir);
  await settings.load();
  const feeds = await FeedsStore.open(dir);
  const newsPrefs = await NewsPrefsStore.open(dir);
  const briefing = await BriefingService.open(dir, cfg.tz);
  const aiSecurity = await AiSecurityService.open(dir);
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const { panelUpdates, hobieQueue } = await openIntegrationStores(dir);
  const server = createApp({ cfg, auth: makeAuthenticator(cfg), settings, feeds, briefing, aiSecurity, dailyBriefing, newsPrefs, notes, panelUpdates, hobieQueue });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const r = await fetch(`${base}/api/todoist`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(r.status, 200);
    const j: any = await r.json();
    assert.equal(j.configured, false);
    assert.deepEqual(j.overdue, []);
    assert.deepEqual(j.today, []);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
