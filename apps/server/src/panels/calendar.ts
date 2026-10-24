import { fetchCalendarEvents } from "../calendar/service";
import { loadingState, panelCard } from "../ui/components";
import type { PanelModule } from "./types";
import { ValidationError } from "../settings";

export const calendarPanel: PanelModule = {
  id: "calendar",
  title: "Calendar",
  pageHref: "/calendar",
  dashboardHtml: panelCard("panel-calendar", `
  <div id="calendar-status-wrap">${loadingState()}</div>
  <ul id="calendar-list" class="ui-list"></ul>`),
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (path === "/api/calendar" && req.method === "GET") {
      const url = new URL(req.url ?? "/", "http://local");
      const horizon = Number(url.searchParams.get("horizonDays") ?? 14);
      if (!Number.isFinite(horizon)) throw new ValidationError("horizonDays must be a number");
      const horizonDays = Math.min(60, Math.max(7, horizon));
      const start = url.searchParams.get("start"), end = url.searchParams.get("end");
      let rangeStart: Date | undefined, rangeEnd: Date | undefined;
      if (start !== null || end !== null) {
        const validDay = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)
          && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
        if (!validDay(start) || !validDay(end)) throw new ValidationError("start and end must be valid YYYY-MM-DD dates");
        rangeStart = new Date(`${start}T00:00:00Z`);
        rangeEnd = new Date(`${end}T00:00:00Z`);
        const days = (rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000;
        if (days <= 0 || days > 62) throw new ValidationError("Calendar range must be between 1 and 62 days");
      }
      const options = {
        horizonDays,
        rangeStart,
        rangeEnd,
        limit: rangeStart ? 2_000 : undefined,
        localFiles: ctx.cfg.icsLocalFiles,
      };
      const snap = ctx.calendar
        ? await ctx.calendar.snapshot(options)
        : await fetchCalendarEvents(ctx.cfg.icsUrls, ctx.cfg.tz, options);
      snap.feeds = snap.feeds.map(({ url: _url, ...feed }) => ({
        ...feed, url: "", error: feed.ok ? undefined : "Calendar feed could not be loaded. Check Calendar settings.",
      }));
      json(200, snap);
      return true;
    }
    return false;
  },
};

export function calendarDashboardScript(): string {
  return `
function fmtEventWhen(ev){
  if(ev.allDay)return ev.start.slice(0,10)+" (all day)";
  var d=new Date(ev.start);
  return d.toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
}
function renderCalendar(r){
  var stWrap=document.getElementById("calendar-status-wrap");
  var list=document.getElementById("calendar-list");
  if(!r.configured){
    if(stWrap)stWrap.innerHTML='<div class="ui-error" role="alert"><p class="ui-error-text bad">No calendars connected. Open Settings &gt; Calendars to add one.</p></div>';
    if(list)list.innerHTML="";
    return;
  }
  var bad=(r.feeds||[]).filter(function(f){return !f.ok});
  if(stWrap)stWrap.innerHTML='<p class="dim" id="calendar-status">'+(r.events||[]).length+" upcoming"
    +(bad.length?" · "+bad.length+" feed error(s)":"")+'</p>';
  if(!list)return;
  list.innerHTML=(r.events||[]).map(function(ev){
    return '<li><strong>'+esc(ev.summary)+'</strong> · '+esc(fmtEventWhen(ev))
      +(ev.location?' · <span class="dim">'+esc(ev.location)+'</span>':'')+'</li>';
  }).join("")||'<li><div class="ui-empty" role="status"><p class="ui-empty-title">No upcoming events in the next two weeks.</p></div></li>';
}
function loadCalendar(){return api("/api/calendar").then(renderCalendar)}
loadCalendar();
`;
}
