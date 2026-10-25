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
import { notifyIfAllowed, resolveNtfyRuntime } from "./ntfy";
import type { NtfySentSet } from "./sent-set";
import type { CalendarEvent } from "../calendar/parse-ics";

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

function absoluteUrl(runtime: ReturnType<typeof resolveNtfyRuntime>, path: string): string | undefined {
  const base = runtime.publicBaseUrl?.replace(/\/+$/, "");
  if (!base) return undefined;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function sendBriefingDigest(
  deps: NtfyTickDeps,
  rec: DailyBriefingRecord,
  slot: string,
): Promise<void> {
  const runtime = resolveNtfyRuntime(deps.deployment, deps.effective);
  if (!runtime.enabled) return;
  const key = digestKey(slot);
  if (deps.sent.has(key)) return;
  const lines = briefingDigestLines(rec);
  const ok = await notifyIfAllowed(runtime, {
    title: "Daily briefing",
    body: lines.join("\n"),
    priority: "default",
    tags: ["briefing"],
    click: absoluteUrl(runtime, "/briefing"),
  }, deps.now);
  if (ok) await deps.sent.mark(key);
}

export async function runCalendarReminders(deps: NtfyTickDeps): Promise<void> {
  const runtime = resolveNtfyRuntime(deps.deployment, deps.effective);
  if (!runtime.enabled || !deps.calendar) return;
  const horizonMs = runtime.reminderMinutes * 60_000;
  const snap = await deps.calendar.snapshot({
    rangeStart: deps.now,
    rangeEnd: new Date(deps.now.getTime() + horizonMs),
    limit: 50,
  });
  for (const event of snap.events) {
    const startMs = event.start.getTime();
    if (startMs < deps.now.getTime() || startMs > deps.now.getTime() + horizonMs) continue;
    const key = eventReminderKey(event);
    if (deps.sent.has(key)) continue;
    const mins = Math.max(1, Math.round((startMs - deps.now.getTime()) / 60_000));
    const when = event.allDay ? "today" : `in ${mins} min`;
    const ok = await notifyIfAllowed(runtime, {
      title: event.summary.slice(0, 120) || "Calendar event",
      body: `Starts ${when}${event.location ? ` · ${event.location.slice(0, 80)}` : ""}`,
      priority: "high",
      tags: ["calendar"],
      click: absoluteUrl(runtime, "/calendar"),
    }, deps.now);
    if (ok) await deps.sent.mark(key);
  }
}

export async function runCoachNudge(deps: NtfyTickDeps): Promise<void> {
  const runtime = resolveNtfyRuntime(deps.deployment, deps.effective);
  if (!runtime.enabled || !deps.board || !deps.notes || !deps.wins || !deps.attention) return;
  const today = dayKey(deps.now, runtime.tz);
  const key = coachKey(today);
  if (deps.sent.has(key)) return;
  const snap = deps.attention.snapshot();
  const sections = composeAttentionSections({
    todayYmd: today,
    tz: runtime.tz,
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
  const ok = await notifyIfAllowed(runtime, {
    title: "Attention",
    body: `${top.title} — ${top.reason}`,
    priority: "low",
    tags: ["coach"],
    click: absoluteUrl(runtime, top.href),
  }, deps.now);
  if (ok) await deps.sent.mark(key);
}

export async function runNtfyTick(deps: NtfyTickDeps): Promise<void> {
  await deps.sent.prune();
  await runCalendarReminders(deps);
  await runCoachNudge(deps);
}
