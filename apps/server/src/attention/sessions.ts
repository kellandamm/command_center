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
  const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(
    new Date(session.end),
  );
  const when = new Date(session.end).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return count === 1 ? `worked on ${dateLabel}` : `${count} edits ending ${when}`;
}

function sessionSummaryLine(session: WorkSession, todayYmd: string, tz: string): string {
  const count = session.events.length;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(session.end));
  if (day === todayYmd) return count === 1 ? "1 edit earlier today" : `${count} edits earlier today`;
  const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(
    new Date(session.end),
  );
  return count === 1 ? `1 edit on ${dateLabel}` : `${count} edits on ${dateLabel}`;
}

/** Merge older sessions into the reason for the most recent session on the same item. */
export function mergedSessionReason(sessions: WorkSession[], todayYmd: string, tz: string): string {
  const sorted = [...sessions].sort((a, b) => b.end.localeCompare(a.end));
  const latest = sorted[0]!;
  let reason = sessionReason(latest, todayYmd, tz);
  if (sorted.length === 1) return reason;
  const also = sorted.slice(1).map((s) => sessionSummaryLine(s, todayYmd, tz));
  return `${reason}; also ${also.join(", ")}`;
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
