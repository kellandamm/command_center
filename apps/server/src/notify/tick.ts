import type { BoardStore } from "../board/store";
import type { CalendarWorkspace } from "../calendar/workspace";
import type { Config } from "../config";
import type { DailyBriefingRecord } from "../daily-briefing/types";
import type { NotesStore } from "../notes/store";
import { isNoteSensitive } from "../notes/sensitive";
import { composeAttentionSections } from "../attention/sections";
import type { AttentionStore } from "../attention/store";
import type { WinsStore } from "../wins/store";
import { dayKey } from "../store";
import { briefingDigestLines } from "./briefing-digest";
import { notify, notifyIfAllowed, resolveNtfyConfig, type NtfyResolved } from "./ntfy";
import type { NtfySentSet } from "./sent-set";
import type { CalendarEvent } from "../calendar/parse-ics";
import { NTFY_QUIET_TZ } from "./quiet-hours";

export const NTFY_TICK_INTERVAL_MS = 60_000;
export const NTFY_MAX_SENDS_PER_TICK = 10;

export interface NtfyTickDeps {
  deployment: Config;
  effective: Config;
  calendar?: CalendarWorkspace;
  board?: BoardStore;
  notes?: NotesStore;
  wins?: WinsStore;
  attention?: AttentionStore;
  sent: NtfySentSet;
  now: Date;
}

let lastCalendarReminderErrorAt = 0;

function eventReminderKey(event: CalendarEvent): string {
  const cal = event.calendarId ?? "legacy";
  const start = event.start.toISOString();
  return `reminder:${cal}:${event.uid}:${start}`;
}

function digestKey(slot: string): string {
  return `digest:${slot}`;
}

function coachKey(day: string): string {
  return `coach:${day}`;
}

function absoluteUrl(runtime: NtfyResolved, path: string): string | undefined {
  const base = runtime.publicBaseUrl?.replace(/\/+$/, "");
  if (!base) return undefined;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Morning digest is always sent (ignores quiet hours). */
export async function sendBriefingDigest(
  deps: NtfyTickDeps,
  rec: DailyBriefingRecord,
  slot: string,
): Promise<void> {
  const cfg = resolveNtfyConfig(deps.deployment, deps.effective);
  if (!cfg.enabled) return;
  const key = digestKey(slot);
  if (deps.sent.has(key)) return;
  const lines = briefingDigestLines(rec);
  const ok = await notify(cfg, {
    title: "Daily briefing",
    body: lines.join("\n"),
    priority: "default",
    tags: ["briefing"],
    click: absoluteUrl(cfg, "/briefing"),
  });
  if (ok) await deps.sent.mark(key);
}

function inReminderLeadWindow(msUntilStart: number, leadMs: number): boolean {
  const slackMs = NTFY_TICK_INTERVAL_MS;
  return msUntilStart > 0 && msUntilStart <= leadMs && msUntilStart > leadMs - slackMs;
}

export async function runCalendarReminders(deps: NtfyTickDeps, budget: { remaining: number }): Promise<void> {
  const cfg = resolveNtfyConfig(deps.deployment, deps.effective);
  if (!cfg.enabled || !deps.calendar || budget.remaining <= 0) return;
  const leadMs = cfg.reminderMinutes * 60_000;
  try {
    const snap = await deps.calendar.snapshot({
      rangeStart: deps.now,
      rangeEnd: new Date(deps.now.getTime() + leadMs + NTFY_TICK_INTERVAL_MS),
      limit: 50,
    });
    for (const event of snap.events) {
      if (budget.remaining <= 0) break;
      if (event.allDay) continue;
      const startMs = event.start.getTime();
      const msUntilStart = startMs - deps.now.getTime();
      if (!inReminderLeadWindow(msUntilStart, leadMs)) continue;
      const key = eventReminderKey(event);
      if (deps.sent.has(key)) continue;
      const mins = Math.max(1, Math.round(msUntilStart / 60_000));
      const ok = await notifyIfAllowed(cfg, {
        title: event.summary.slice(0, 120) || "Calendar event",
        body: `Starts in ${mins} min${event.location ? ` · ${event.location.slice(0, 80)}` : ""}`,
        priority: "default",
        tags: ["calendar"],
        click: absoluteUrl(cfg, "/calendar"),
      }, deps.now);
      if (ok) {
        await deps.sent.mark(key);
        budget.remaining--;
      }
    }
  } catch {
    const now = Date.now();
    if (now - lastCalendarReminderErrorAt >= 15 * 60_000) {
      console.error("ntfy: calendar reminders skipped (calendar unavailable)");
      lastCalendarReminderErrorAt = now;
    }
  }
}

async function runCoachNudge(deps: NtfyTickDeps, budget: { remaining: number }): Promise<void> {
  const cfg = resolveNtfyConfig(deps.deployment, deps.effective);
  if (!cfg.coachEnabled || !cfg.enabled || budget.remaining <= 0) return;
  if (!deps.board || !deps.notes || !deps.wins || !deps.attention) return;
  const today = dayKey(deps.now, NTFY_QUIET_TZ);
  const key = coachKey(today);
  if (deps.sent.has(key)) return;
  const snap = deps.attention.snapshot();
  const sections = composeAttentionSections({
    todayYmd: today,
    tz: deps.effective.tz,
    nowMs: deps.now.getTime(),
    cards: deps.board.list(),
    notes: deps.notes.listNotes().filter((n) => !isNoteSensitive(n)),
    sources: deps.notes.listSources(),
    wins: deps.wins.list(500),
    timeline: [],
    pinned: snap.pinned,
    hidden: new Set(snap.hidden),
    isSnoozed: (id) => deps.attention!.isSnoozed(id, deps.now.getTime()),
  });
  const due = sections.find((s) => s.id === "due");
  const top = due?.items[0];
  if (!top) return;
  const ok = await notifyIfAllowed(cfg, {
    title: "Attention",
    body: `${top.title} — ${top.reason}`,
    priority: "low",
    tags: ["coach"],
    click: absoluteUrl(cfg, top.href),
  }, deps.now);
  if (ok) {
    await deps.sent.mark(key);
    budget.remaining--;
  }
}

export async function runNtfyTick(deps: NtfyTickDeps): Promise<void> {
  await deps.sent.prune();
  const budget = { remaining: NTFY_MAX_SENDS_PER_TICK };
  await runCalendarReminders(deps, budget);
  await runCoachNudge(deps, budget);
}
