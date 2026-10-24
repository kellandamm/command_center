import type { TimelineEvent } from "./types";

export const SESSION_GAP_MS = 45 * 60 * 1000;

export interface WorkSession {
  start: string;
  end: string;
  events: TimelineEvent[];
}

export function buildSessions(events: TimelineEvent[], gapMs = SESSION_GAP_MS): WorkSession[] {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const sessions: WorkSession[] = [];
  let current: WorkSession | null = null;
  for (const ev of sorted) {
    const t = Date.parse(ev.at);
    if (!current) {
      current = { start: ev.at, end: ev.at, events: [ev] };
      continue;
    }
    const last = Date.parse(current.end);
    if (t - last <= gapMs) {
      current.events.push(ev);
      current.end = ev.at;
    } else {
      sessions.push(current);
      current = { start: ev.at, end: ev.at, events: [ev] };
    }
  }
  if (current) sessions.push(current);
  return sessions;
}

export function sessionReason(session: WorkSession, todayYmd: string, tz: string): string {
  const count = session.events.length;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(session.end));
  if (day === todayYmd) {
    return count === 1 ? "edited once today" : `edited ${count} times today`;
  }
  const when = new Date(session.end).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return count === 1 ? `worked on at ${when}` : `${count} edits ending ${when}`;
}

export function sessionPrimaryItem(session: WorkSession): TimelineEvent {
  const byRef = new Map<string, TimelineEvent>();
  for (const ev of session.events) {
    const prev = byRef.get(ev.refId);
    if (!prev || ev.at > prev.at) byRef.set(ev.refId, ev);
  }
  const items = [...byRef.values()].sort((a, b) => b.at.localeCompare(a.at));
  return items[0]!;
}
