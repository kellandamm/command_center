import type { CalendarEvent } from "../calendar/parse-ics";
import { esc } from "../ui/layout";

const DEFAULT_START_H = 8;
const DEFAULT_END_H = 16;

function formatDayTitle(date: Date, tz: string): string {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });
}

function eventDayKey(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
}

function minutesInTz(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function nowMinutesInTz(now: Date, tz: string): number {
  return minutesInTz(now.toISOString(), tz);
}

export function agendaWindowHours(events: CalendarEvent[], dayKey: string, tz: string, now: Date): { startH: number; endH: number } {
  let startH = DEFAULT_START_H;
  let endH = DEFAULT_END_H;
  const todayEvents = events.filter((ev) => eventDayKey(ev.start.toISOString(), tz) === dayKey && !ev.allDay);
  for (const ev of todayEvents) {
    const startM = minutesInTz(ev.start.toISOString(), tz);
    const endM = minutesInTz((ev.end ?? ev.start).toISOString(), tz);
    const crossesMidnight = endM < startM;
    const endEffective = crossesMidnight ? endM + 24 * 60 : endM;
    startH = Math.min(startH, Math.floor(startM / 60));
    endH = Math.max(endH, Math.ceil(endEffective / 60));
  }
  const nowM = nowMinutesInTz(now, tz);
  if (eventDayKey(now.toISOString(), tz) === dayKey) {
    startH = Math.min(startH, Math.floor(nowM / 60));
    endH = Math.max(endH, Math.ceil(nowM / 60) + 1);
  }
  startH = Math.max(0, Math.min(startH, 23));
  endH = Math.max(startH + 1, Math.min(endH, 24));
  return { startH, endH };
}

/** 0–100 position of the now marker within the agenda window (clamped). Exported for tests. */
export function agendaNowMarkerPercent(now: Date, tz: string, window?: { startH: number; endH: number }): number {
  const win = window ?? { startH: DEFAULT_START_H, endH: DEFAULT_END_H };
  const mins = nowMinutesInTz(now, tz);
  const start = win.startH * 60;
  const end = win.endH * 60;
  const span = end - start;
  if (span <= 0) return 0;
  const pct = ((mins - start) / span) * 100;
  return Math.max(0, Math.min(100, pct));
}

function nowLabel(now: Date, tz: string): string {
  return now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
}

function eventsForDay(events: CalendarEvent[], dayKey: string, tz: string): CalendarEvent[] {
  return events.filter((ev) => eventDayKey(ev.start.toISOString(), tz) === dayKey);
}

export function renderTodayAgendaWidget(events: CalendarEvent[], tz: string, now = new Date()): string {
  const dayKey = eventDayKey(now.toISOString(), tz);
  const todayEvents = eventsForDay(events, dayKey, tz);
  const win = agendaWindowHours(events, dayKey, tz, now);
  const title = `Today · ${formatDayTitle(now, tz)}`;
  const next = todayEvents.find((ev) => ev.start.getTime() > now.getTime());
  const summaryParts = [`${todayEvents.length} event${todayEvents.length === 1 ? "" : "s"}`];
  if (next) {
    const mins = Math.round((next.start.getTime() - now.getTime()) / 60_000);
    summaryParts.push(`next: ${next.summary} in ${mins} min`);
  }
  const markerPct = agendaNowMarkerPercent(now, tz, win);
  const spanH = win.endH - win.startH;
  const hours: string[] = [];
  for (let h = win.startH; h <= win.endH; h++) {
    const label = h === 24 ? "12 AM" : h <= 12 ? `${h === 0 ? 12 : h} ${h < 12 ? "AM" : "PM"}` : `${h - 12} PM`;
    hours.push(`<div class="agenda-hour" style="left:${((h - win.startH) / spanH) * 100}%">${label}</div>`);
  }
  const winStart = win.startH * 60;
  const winEnd = win.endH * 60;
  const blocks = todayEvents
    .filter((ev) => !ev.allDay)
    .map((ev) => {
      let startM = minutesInTz(ev.start.toISOString(), tz);
      let endM = minutesInTz((ev.end ?? ev.start).toISOString(), tz);
      if (endM < startM) endM += 24 * 60;
      const left = ((Math.max(startM, winStart) - winStart) / (winEnd - winStart)) * 100;
      const width = ((Math.min(endM, winEnd) - Math.max(startM, winStart)) / (winEnd - winStart)) * 100;
      if (width <= 0) return "";
      return `<div class="agenda-event" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" title="${esc(ev.summary)}">${esc(ev.summary)}</div>`;
    })
    .join("");
  return `<div class="widget-today-agenda">
  <p class="dim agenda-summary">${esc(summaryParts.join(" · "))}</p>
  <div class="agenda-timeline" role="img" aria-label="Today's schedule">
    ${hours.join("")}
    ${blocks}
    <div class="agenda-now" style="left:${markerPct.toFixed(2)}%"><span>${esc(nowLabel(now, tz))}</span></div>
  </div>
</div>`;
}
