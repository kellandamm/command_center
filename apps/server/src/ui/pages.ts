import type { NavLink } from "./layout";
import { page } from "./layout";

export function dashboardPage(nav?: NavLink[]): string {
  return page({
    title: "Command center",
    active: "/",
    nav,
    body: `<div class="dashboard-page"><header class="page-header"><h1>Dashboard</h1><p class="dim">A quick view of what needs attention and what's coming up.</p></header>
<div class="dashboard-overview">
  <section class="card dashboard-overview-card dashboard-attention-card" data-dashboard-card="attention">
    <h2>Needs attention</h2>
    <div class="dashboard-metrics">
      <a class="dashboard-metric" href="/board"><span>Hobie board</span><strong id="dashboard-hobie-count">Loading…</strong><span class="dim" id="dashboard-hobie-detail"></span></a>
      <a class="dashboard-metric" href="/library?view=inbox"><span>Read later</span><strong id="dashboard-news-count">Loading…</strong><span class="dim">Open your inbox</span></a>
    </div>
  </section>
  <section class="card dashboard-overview-card" data-dashboard-card="calendar">
    <h2>Next up</h2>
    <p id="dashboard-calendar-status" class="dashboard-summary">Loading calendar…</p>
    <a href="/calendar" class="dashboard-card-link">Open calendar</a>
  </section>
  <section class="card dashboard-overview-card" data-dashboard-card="briefing">
    <h2>Today's briefing</h2>
    <p id="dashboard-briefing-status" class="dashboard-summary">Loading briefing…</p>
    <a href="/briefing" class="dashboard-card-link">Open daily briefing</a>
  </section>
  <section class="card dashboard-overview-card" data-dashboard-card="activity">
    <h2>Recent agent activity</h2>
    <p id="dashboard-activity-status" class="dashboard-summary">Loading activity…</p>
    <a href="/activity" class="dashboard-card-link">Open activity</a>
  </section>
</div></div>`,
    script: `
function dashboardSetError(id,err){
  var el=document.getElementById(id);
  if(!el)return;
  el.textContent="Could not load: "+(err&&err.message?err.message:"request failed");
  el.classList.add("bad");
}
function loadDashboardHobie(){
  return api("/api/hobie/board-summary").then(function(r){
    var counts=r.counts||{},keys=Object.keys(counts),total=keys.reduce(function(n,k){return n+(counts[k]||0)},0);
    var ready=counts["Ready for Hobie"]||0,waiting=counts["Waiting"]||0;
    document.getElementById("dashboard-hobie-count").textContent=String(total);
    document.getElementById("dashboard-hobie-detail").textContent=ready||waiting?ready+" ready · "+waiting+" waiting":"Open board";
  }).catch(function(err){dashboardSetError("dashboard-hobie-count",err)});
}
function loadDashboardNews(){
  return api("/api/read-later").then(function(r){
    document.getElementById("dashboard-news-count").textContent=String(r.inboxCount||0);
  }).catch(function(err){dashboardSetError("dashboard-news-count",err)});
}
function loadDashboardCalendar(){
  return api("/api/calendar?horizonDays=7").then(function(r){
    var el=document.getElementById("dashboard-calendar-status");
    if(!r.configured){el.textContent="Calendar isn't configured.";return}
    var event=(r.events||[])[0];
    if(!event){el.textContent="No upcoming events this week.";return}
    var when=event.allDay?new Date(event.start).toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"}):new Date(event.start).toLocaleString(undefined,{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
    el.textContent=event.summary+" · "+when;
  }).catch(function(err){dashboardSetError("dashboard-calendar-status",err)});
}
function loadDashboardBriefing(){
  return api("/api/daily-briefing").then(function(r){
    var el=document.getElementById("dashboard-briefing-status"),b=r.briefing;
    if(!b){el.textContent="No briefing has been prepared for today.";return}
    var sources=Object.keys(b.sources||{}).map(function(k){return b.sources[k]});
    var errors=sources.filter(function(s){return s.status==="error"}).length;
    var ok=sources.filter(function(s){return s.status==="ok"}).length;
    el.textContent=b.day+" · "+ok+" sources ready"+(errors?" · "+errors+" errors":"");
  }).catch(function(err){dashboardSetError("dashboard-briefing-status",err)});
}
function loadDashboardActivity(){
  return api("/api/activity/updates?limit=5").then(function(r){
    var el=document.getElementById("dashboard-activity-status"),rows=r.updates||[];
    if(!rows.length){el.textContent="No agent updates yet.";return}
    var latest=rows[0],when=new Date(latest.createdAt).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
    el.textContent=rows.length+" recent update"+(rows.length===1?"":"s")+" · Latest from "+latest.clientId+" · "+when;
  }).catch(function(err){dashboardSetError("dashboard-activity-status",err)});
}
window.viewPreferencesReady.then(function(prefs){
  var dashboard=prefs&&prefs.dashboard||{};
  document.querySelectorAll("[data-dashboard-card]").forEach(function(card){
    var key=card.dataset.dashboardCard;
    if(key==="attention"&&dashboard.hobie===false)card.querySelector('a[href="/board"]').hidden=true;
    else if(key!=="attention"&&dashboard[key]===false)card.hidden=true;
  });
  if(dashboard.hobie!==false)loadDashboardHobie();
  loadDashboardNews();
  if(dashboard.calendar!==false)loadDashboardCalendar();
  if(dashboard.briefing!==false)loadDashboardBriefing();
  if(dashboard.activity!==false)loadDashboardActivity();
});
`,
  });
}

export function settingsPage(nav?: NavLink[]): string {
  return page({
    title: "Settings",
    active: "/settings",
    nav,
    body: `<header class="page-header"><h1>Settings</h1><p class="dim">Tune schedules, view behavior, and navigation.</p></header>
<div class="settings-tabs" role="tablist">
  <button type="button" class="ghost on" data-tab="views">Views</button>
  <button type="button" class="ghost" data-tab="schedule">Schedule</button>
  <button type="button" class="ghost" data-tab="tabs">Tabs</button>
</div>
<div class="card settings-card settings-tab-panel on" id="tab-views">
<p class="dim">Choose what each page shows and how it’s displayed. These preferences are saved on this server.</p>
<div class="settings-options-grid">
<div class="settings-option"><label for="pref-density">Page density</label><select id="pref-density" data-pref="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select><p class="dim">Compact reduces spacing across supported pages.</p></div>
<fieldset class="settings-option"><legend>Dashboard cards</legend>
<label class="row choice-row"><input type="checkbox" data-pref="dashboard.hobie"/> Hobie board</label><label class="row choice-row"><input type="checkbox" data-pref="dashboard.calendar"/> Next calendar event</label><label class="row choice-row"><input type="checkbox" data-pref="dashboard.briefing"/> Daily briefing</label><label class="row choice-row"><input type="checkbox" data-pref="dashboard.activity"/> Agent activity</label></fieldset>
<fieldset class="settings-option"><legend>Daily Briefing sections</legend>
<label class="row choice-row"><input type="checkbox" data-pref="briefing.todoist"/> Todoist tasks</label><label class="row choice-row"><input type="checkbox" data-pref="briefing.weather"/> Weather</label><label class="row choice-row"><input type="checkbox" data-pref="briefing.calendar"/> Calendar</label><label class="row choice-row"><input type="checkbox" data-pref="briefing.github"/> GitHub</label></fieldset>
<div class="settings-option"><label for="pref-hobie-status">Hobie queue filter</label><select id="pref-hobie-status" data-pref="hobie.status"><option value="all">All tasks</option><option value="pending">Pending</option><option value="claimed">Claimed</option><option value="done">Done</option></select></div>
<div class="settings-option"><label for="pref-calendar-week">Calendar week starts on</label><select id="pref-calendar-week" data-pref="calendar.weekStartsOn"><option value="monday">Monday</option><option value="sunday">Sunday</option></select></div>
<div class="settings-option"><label for="pref-activity-limit">Activity entries</label><select id="pref-activity-limit" data-pref="activity.limit"><option value="25">25</option><option value="50">50</option><option value="100">100</option><option value="200">200</option></select></div>
<div class="settings-option"><label for="pref-notes-size">Notes text size</label><select id="pref-notes-size" data-pref="notes.fontSize"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></div>
</div>
<div class="row" style="margin-top:1rem"><button type="button" id="views-save">Save view preferences</button><span id="saved-views" class="dim"></span></div>
</div>
<div class="card settings-card settings-tab-panel" id="tab-schedule">
<form id="f-schedule">
<p class="dim">Prepare your daily calendar, weather, tasks, GitHub activity, and wins at this time in the server's configured timezone.</p>
<label for="briefingTime">Daily briefing time</label><input id="briefingTime" type="time" required>
<div class="row" style="margin-top:18px"><button type="submit">Save schedule</button><span id="saved-schedule" class="dim"></span></div>
</form></div>
<div class="card settings-card settings-tab-panel" id="tab-tabs">
<p class="dim">Show, hide, rename, and reorder sidebar tabs. Dashboard and Settings are always visible.</p>
<div id="tabs-editor"></div>
<div class="row" style="margin-top:1rem"><button type="button" id="tabs-save">Save tabs</button><span id="saved-tabs" class="dim"></span></div>
</div>`,
    script: `
var settingsState={sidebarTabs:[],viewPreferences:{}};
function showTab(name){
  document.querySelectorAll(".settings-tabs button").forEach(function(b){b.classList.toggle("on",b.dataset.tab===name)});
  document.querySelectorAll(".settings-tab-panel").forEach(function(p){p.classList.toggle("on",p.id==="tab-"+name)});
}
document.querySelectorAll(".settings-tabs button").forEach(function(b){b.onclick=function(){showTab(b.dataset.tab)}});
function getPref(path){
  return path.split(".").reduce(function(obj,key){return obj&&obj[key]},settingsState.viewPreferences);
}
function setPref(path,value){
  var keys=path.split("."),target=settingsState.viewPreferences;
  keys.slice(0,-1).forEach(function(key){target=target[key]});
  target[keys[keys.length-1]]=value;
}
function bindViewPreferences(){
  document.querySelectorAll("[data-pref]").forEach(function(el){
    var path=el.dataset.pref,value=getPref(path);
    if(el.type==="checkbox")el.checked=!!value;
    else el.value=String(value);
    el.onchange=function(){
      var numeric=path==="activity.limit";
      setPref(path,el.type==="checkbox"?el.checked:(numeric?Number(el.value):el.value));
    };
  });
}
function renderTabsEditor(){
  var el=document.getElementById("tabs-editor");
  var rows=settingsState.sidebarTabs.slice().sort(function(a,b){return a.order-b.order});
  el.innerHTML=rows.map(function(t,idx){
    var lock=t.locked?" disabled":"";
    var vis=t.locked?"":'<label class="row choice-row" style="margin:0;font-size:.8125rem"><input type="checkbox" class="tab-vis" data-id="'+esc(t.id)+'"'+(t.visible?" checked":"")+'/> Visible</label>';
    return '<div class="row" style="align-items:center;margin-bottom:.5rem;gap:.5rem" data-id="'+esc(t.id)+'">'
      +'<span class="dim" style="width:1.5rem">'+String(idx+1)+'</span>'
      +'<input type="text" class="tab-label" data-id="'+esc(t.id)+'" value="'+esc(t.label)+'" style="flex:1"'+lock+'/>'
      +vis
      +'<button type="button" class="ghost tab-up" data-id="'+esc(t.id)+'"'+lock+'>↑</button>'
      +'<button type="button" class="ghost tab-down" data-id="'+esc(t.id)+'"'+lock+'>↓</button></div>';
  }).join("");
  el.querySelectorAll(".tab-vis").forEach(function(cb){cb.onchange=function(){
    var t=settingsState.sidebarTabs.find(function(x){return x.id===cb.dataset.id});if(t&&!t.locked)t.visible=cb.checked;
  }});
  el.querySelectorAll(".tab-label").forEach(function(inp){inp.onchange=function(){
    var t=settingsState.sidebarTabs.find(function(x){return x.id===inp.dataset.id});if(t)t.label=inp.value;
  }});
  function swap(id,dir){
    var sorted=settingsState.sidebarTabs.slice().sort(function(a,b){return a.order-b.order});
    var i=sorted.findIndex(function(x){return x.id===id});if(i<0)return;
    var j=i+dir;if(j<0||j>=sorted.length)return;
    var a=sorted[i],b=sorted[j];var oa=a.order,ob=b.order;a.order=ob;b.order=oa;
    renderTabsEditor();
  }
  el.querySelectorAll(".tab-up").forEach(function(b){b.onclick=function(){swap(b.dataset.id,-1)}});
  el.querySelectorAll(".tab-down").forEach(function(b){b.onclick=function(){swap(b.dataset.id,1)}});
}
function loadSettings(){
  return api("/api/settings").then(function(r){
    var s=r.settings;
    settingsState.sidebarTabs=s.sidebarTabs||[];
    settingsState.viewPreferences=s.viewPreferences||{};
    document.getElementById("briefingTime").value=s.briefingTime;
    renderTabsEditor();bindViewPreferences();
  });
}
document.getElementById("f-schedule").onsubmit=function(e){e.preventDefault();
  document.getElementById("saved-schedule").textContent="Saving…";
  api("/api/settings","PUT",{briefingTime:document.getElementById("briefingTime").value})
    .then(function(){document.getElementById("saved-schedule").textContent="Saved";location.reload()})
    .catch(function(err){document.getElementById("saved-schedule").textContent=err.message});
};
document.getElementById("views-save").onclick=function(){
  var status=document.getElementById("saved-views");
  status.textContent="Saving…";
  api("/api/settings","PUT",{viewPreferences:settingsState.viewPreferences})
    .then(function(){status.textContent="Saved";location.reload()})
    .catch(function(err){status.textContent=err.message});
};
document.getElementById("tabs-save").onclick=function(){
  document.getElementById("saved-tabs").textContent="Saving…";
  api("/api/settings","PUT",{sidebarTabs:settingsState.sidebarTabs})
    .then(function(){document.getElementById("saved-tabs").textContent="Saved";location.reload()})
    .catch(function(err){document.getElementById("saved-tabs").textContent=err.message});
};
loadSettings();
`,
  });
}
