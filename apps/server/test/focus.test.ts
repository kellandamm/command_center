import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { NotesStore } from "../src/notes/store";
import { SettingsStore } from "../src/settings";
import { MAX_FOCUS_DURATION_MS, validateFocusSessionInput } from "../src/focus/store";
import { OWNER_ACTION_FORBIDDEN } from "../src/owner-auth";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const TOKEN = "f".repeat(32);

test("focus: validates session duration and caps", () => {
  const start = "2026-10-24T10:00:00.000Z";
  const end = "2026-10-24T10:25:00.000Z";
  const parsed = validateFocusSessionInput({
    startedAt: start,
    endedAt: end,
    durationMs: 25 * 60 * 1000,
    taskId: "todoist-1",
    taskTitle: "Write tests",
  });
  assert.equal(parsed.durationMs, 25 * 60 * 1000);

  assert.throws(
    () =>
      validateFocusSessionInput({
        startedAt: start,
        endedAt: new Date(Date.parse(start) + MAX_FOCUS_DURATION_MS + 1000).toISOString(),
        durationMs: MAX_FOCUS_DURATION_MS + 1000,
        taskId: "todoist-1",
      }),
    /cannot exceed/,
  );
});

test("focus: owner-only POST logs sessions and heatmap sees them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-focus-"));
  const cfg = loadConfig({ DATA_DIR: dir, ADMIN_TOKEN: TOKEN, ALLOW_INSECURE_NO_AUTH: "1", TZ: "UTC" });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const server = createApp({ cfg, auth: makeAuthenticator(cfg), settings, dailyBriefing, notes, ...integration });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-ah": "1" };
  const body = {
    startedAt: "2026-10-24T10:00:00.000Z",
    endedAt: "2026-10-24T10:25:00.000Z",
    durationMs: 25 * 60 * 1000,
    taskId: "todoist-99",
    taskTitle: "Deep work",
  };

  try {
    const denied = await fetch(`${base}/api/focus/sessions`, { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error, OWNER_ACTION_FORBIDDEN);

    await integration.focusSessions.append(body);
    const heatmap = await fetch(`${base}/api/dashboard/heatmap`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const heat = await heatmap.json() as { days: Array<{ date: string; count: number }> };
    const day = heat.days.find((d) => d.date === "2026-10-24");
    assert.ok(day && day.count > 0, "focus session end should count on heatmap");

    const tasks = await fetch(`${base}/api/dashboard/focus/tasks`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const taskBody = await tasks.json();
    assert.equal(taskBody.configured, false);
  } finally {
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
