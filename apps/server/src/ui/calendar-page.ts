import type { NavLink } from "./layout";
import { page } from "./layout";

export function calendarPage(nav?: NavLink[]): string {
  return page({
    title: "Calendar — Command center",
    active: "/calendar",
    nav,
    body: `<header class="page-header"><h1>Calendar</h1><p class="dim">Week view from ICS feeds configured on the server.</p></header>
<div class="card"><div class="row" style="margin-bottom:.75rem;justify-content:space-between">
  <button type="button" class="ghost" id="cal-prev">← Previous week</button>
  <span id="cal-week-label" class="dim"></span>
  <button type="button" class="ghost" id="cal-next">Next week →</button>
</div>
<p class="dim" id="calendar-status-full">Loading…</p>
<div id="cal-week-grid" class="cal-week-grid"></div></div>`,
    script: `
var calWeekStart=new Date();calWeekStart.setHours(0,0,0,0);
calWeekStart.setDate(calWeekStart.getDate()-((calWeekStart.getDay()+6)%7));
function startOfWeek(d){var x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x;}
function addDays(d,n){var x=new Date(d);x.setDate(x.getDate()+n);return x;}
function fmtDay(d){return d.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});}
function fmtEventWhen(ev){
  if(ev.allDay)return "All day";
  var t=new Date(ev.start);
  return t.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
}
function renderWeek(data){
  var st=document.getElementById("calendar-status-full");
  var grid=document.getElementById("cal-week-grid");
  document.getElementById("cal-week-label").textContent=fmtDay(calWeekStart)+" – "+fmtDay(addDays(calWeekStart,6));
  if(!data.configured){
    st.textContent="Calendar disabled — set ICS_URLS on the server.";
    grid.innerHTML="";return;
  }
  var bad=(data.feeds||[]).filter(function(f){return !f.ok});
  st.textContent=(data.events||[]).length+" events in range"+(bad.length?" · "+bad.length+" feed error(s)":"");
  var days=[];
  for(var i=0;i<7;i++){
    var day=addDays(calWeekStart,i);
    var key=day.toISOString().slice(0,10);
    var evs=(data.events||[]).filter(function(ev){
      var s=new Date(ev.start);return s.toISOString().slice(0,10)===key||(ev.allDay&&ev.start.slice(0,10)===key);
    });
    days.push('<div class="cal-day"><h3 style="margin:0 0 .5rem;font-size:.8125rem">'+esc(fmtDay(day))+'</h3>'
      +(evs.length?evs.map(function(ev){
        return '<div class="cal-ev"><strong>'+esc(ev.summary)+'</strong><div class="dim">'+esc(fmtEventWhen(ev))+(ev.location?" · "+esc(ev.location):"")+'</div></div>';
      }).join(""):'<p class="dim" style="margin:0;font-size:.8125rem">No events</p>')+'</div>');
  }
  grid.innerHTML=days.join("");
}
function loadCalendarWeek(){
  return api("/api/calendar?horizonDays=42").then(renderWeek);
}
document.getElementById("cal-prev").onclick=function(){calWeekStart=addDays(calWeekStart,-7);loadCalendarWeek()};
document.getElementById("cal-next").onclick=function(){calWeekStart=addDays(calWeekStart,7);loadCalendarWeek()};
loadCalendarWeek();
`,
  });
}
