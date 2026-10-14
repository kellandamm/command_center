import { fetchCalendarEvents } from "../calendar/service";
import type { PanelModule } from "./types";

export const calendarPanel: PanelModule = {
  id: "calendar",
  title: "Calendar",
  pageHref: "/calendar",
  dashboardHtml: `
<section class="card" id="panel-calendar">
  <h2 style="margin:0 0 8px">Calendar</h2>
  <p class="dim" id="calendar-status">Loading…</p>
  <ul id="calendar-list" style="margin:0;padding-left:1.2rem"></ul>
</section>`,
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (path === "/api/calendar" && req.method === "GET") {
      const url = new URL(req.url ?? "/", "http://local");
      const horizonDays = Math.min(60, Math.max(7, Number(url.searchParams.get("horizonDays") ?? 14)));
      const snap = await fetchCalendarEvents(ctx.cfg.icsUrls, ctx.cfg.tz, {
        horizonDays,
        localFiles: ctx.cfg.icsLocalFiles,
      });
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
  var st=document.getElementById("calendar-status");
  var list=document.getElementById("calendar-list");
  if(!r.configured){
    st.textContent="Calendar disabled — set ICS_URLS on the server (comma-separated iCal URLs).";
    list.innerHTML="";
    return;
  }
  var bad=(r.feeds||[]).filter(function(f){return !f.ok});
  st.textContent=(r.events||[]).length+" upcoming"
    +(bad.length?" · "+bad.length+" feed error(s)":"");
  list.innerHTML=(r.events||[]).map(function(ev){
    return '<li><strong>'+esc(ev.summary)+'</strong> · '+esc(fmtEventWhen(ev))
      +(ev.location?' · <span class="dim">'+esc(ev.location)+'</span>':'')+'</li>';
  }).join("")||'<li class="dim">No upcoming events in the next two weeks.</li>';
}
function loadCalendar(){return api("/api/calendar").then(renderCalendar)}
loadCalendar();
`;
}
