import { panels } from "../panels/registry";
import type { NavLink } from "./layout";
import { page } from "./layout";

export function dashboardPage(nav?: NavLink[]): string {
  return page({
    title: "Command center",
    active: "/",
    nav,
    body: `<div class="dashboard-page"><header class="page-header"><h1>Dashboard</h1><p class="dim">A quick view of what needs attention and what's coming up.</p></header>
<div class="dashboard-overview">
  <section class="card dashboard-overview-card dashboard-attention-card">
    <h2>Needs attention</h2>
    <div class="dashboard-metrics">
      <a class="dashboard-metric" href="/hobie"><span>Pending Hobie tasks</span><strong id="dashboard-hobie-count">Loading…</strong><span class="dim" id="dashboard-hobie-detail"></span></a>
      <a class="dashboard-metric" href="/news"><span>Unread news</span><strong id="dashboard-news-count">Loading…</strong><span class="dim">Open News reader</span></a>
    </div>
  </section>
  <section class="card dashboard-overview-card">
    <h2>Next up</h2>
    <p id="dashboard-calendar-status" class="dashboard-summary">Loading calendar…</p>
    <a href="/calendar" class="dashboard-card-link">Open calendar</a>
  </section>
  <section class="card dashboard-overview-card">
    <h2>Today's briefing</h2>
    <p id="dashboard-briefing-status" class="dashboard-summary">Loading briefing…</p>
    <a href="/briefing" class="dashboard-card-link">Open daily briefing</a>
  </section>
  <section class="card dashboard-overview-card">
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
  return api("/api/hobie/queue?status=pending").then(function(r){
    var tasks=r.tasks||[],urgent=tasks.filter(function(t){return t.urgent}).length;
    document.getElementById("dashboard-hobie-count").textContent=String(tasks.length);
    document.getElementById("dashboard-hobie-detail").textContent=urgent?urgent+" urgent":"No urgent tasks";
  }).catch(function(err){dashboardSetError("dashboard-hobie-count",err)});
}
function loadDashboardNews(){
  return api("/api/feeds").then(function(r){
    document.getElementById("dashboard-news-count").textContent=String(r.unread||0);
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
loadDashboardHobie();loadDashboardNews();loadDashboardCalendar();loadDashboardBriefing();loadDashboardActivity();
`,
  });
}

export function settingsPage(nav?: NavLink[]): string {
  return page({
    title: "Settings",
    active: "/settings",
    nav,
    body: `<header class="page-header"><h1>Settings</h1><p class="dim">Schedule, feed scope, and sidebar tabs.</p></header>
<div class="settings-tabs" role="tablist">
  <button type="button" class="ghost on" data-tab="schedule">Schedule</button>
  <button type="button" class="ghost" data-tab="tabs">Tabs</button>
</div>
<div class="card settings-card settings-tab-panel on" id="tab-schedule">
<form id="f-schedule">
<p class="dim">News for the dashboard, AI briefing, and scheduled fetch comes from the <a href="/news">News reader</a> (OPML import). Choose all feeds or specific folders below.</p>
<div class="row" style="gap:16px;margin-top:1rem">
<div style="flex:1"><label for="fetchInterval">Fetch interval (minutes)</label><input id="fetchInterval" type="number" min="5" max="1440"></div>
<div style="flex:1"><label for="briefingTime">Daily briefing time</label><input id="briefingTime" placeholder="07:00"></div>
</div>
<fieldset style="margin-top:1rem;border:0;padding:0">
<legend style="font-weight:600;font-size:.875rem">Feed scope</legend>
<label class="row choice-row" style="margin:.5rem 0"><input type="radio" name="feedScope" value="all" id="scope-all"/> All feeds in News reader</label>
<label class="row choice-row" style="margin:.5rem 0"><input type="radio" name="feedScope" value="folders" id="scope-folders"/> Selected folders only</label>
<div id="scope-folder-list" class="scope-folder-grid dim"></div>
</fieldset>
<div class="row" style="margin-top:18px"><button type="submit">Save schedule</button><span id="saved-schedule" class="dim"></span></div>
</form></div>
<div class="card settings-card settings-tab-panel" id="tab-tabs">
<p class="dim">Show, hide, rename, and reorder sidebar tabs. Dashboard and Settings are always visible.</p>
<div id="tabs-editor"></div>
<div class="row" style="margin-top:1rem"><button type="button" id="tabs-save">Save tabs</button><span id="saved-tabs" class="dim"></span></div>
</div>`,
    script: `
var settingsState={feedScope:{mode:"all",folderIds:[]},sidebarTabs:[]};
function showTab(name){
  document.querySelectorAll(".settings-tabs button").forEach(function(b){b.classList.toggle("on",b.dataset.tab===name)});
  document.querySelectorAll(".settings-tab-panel").forEach(function(p){p.classList.toggle("on",p.id==="tab-"+name)});
}
document.querySelectorAll(".settings-tabs button").forEach(function(b){b.onclick=function(){showTab(b.dataset.tab)}});
function renderFolderScope(){
  return api("/api/rss/tree").then(function(r){
    var tree=r.tree;var box=document.getElementById("scope-folder-list");
    if(!tree||!tree.folders||!tree.folders.length){box.innerHTML="<p>No folders yet — import OPML on News.</p>";return;}
    function walk(nodes,prefix){
      var html="";
      nodes.forEach(function(f){
        var id=f.id;var checked=settingsState.feedScope.folderIds.indexOf(id)>=0;
        html+='<label class="row choice-row" style="margin:.15rem 0"><input type="checkbox" class="scope-folder" data-id="'+esc(id)+'"'+(checked?" checked":"")+'/> '+esc(prefix+f.name)+'</label>';
        if(f.folders&&f.folders.length)html+=walk(f.folders,prefix+f.name+" / ");
      });
      return html;
    }
    box.innerHTML=walk(tree.folders,"");
    box.querySelectorAll(".scope-folder").forEach(function(cb){cb.onchange=function(){
      var id=cb.dataset.id;var ids=settingsState.feedScope.folderIds.slice();
      var i=ids.indexOf(id);if(cb.checked&&i<0)ids.push(id);if(!cb.checked&&i>=0)ids.splice(i,1);
      settingsState.feedScope.folderIds=ids;
    }});
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
    settingsState.feedScope=s.feedScope||{mode:"all",folderIds:[]};
    settingsState.sidebarTabs=s.sidebarTabs||[];
    document.getElementById("fetchInterval").value=s.fetchIntervalMinutes;
    document.getElementById("briefingTime").value=s.briefingTime;
    document.getElementById("scope-all").checked=settingsState.feedScope.mode!=="folders";
    document.getElementById("scope-folders").checked=settingsState.feedScope.mode==="folders";
    renderFolderScope();renderTabsEditor();
  });
}
document.getElementById("f-schedule").onsubmit=function(e){e.preventDefault();
  var mode=document.getElementById("scope-folders").checked?"folders":"all";
  document.getElementById("saved-schedule").textContent="Saving…";
  api("/api/settings","PUT",{fetchIntervalMinutes:document.getElementById("fetchInterval").value,briefingTime:document.getElementById("briefingTime").value,
    feedScope:{mode:mode,folderIds:settingsState.feedScope.folderIds}})
    .then(function(){document.getElementById("saved-schedule").textContent="Saved";location.reload()})
    .catch(function(err){document.getElementById("saved-schedule").textContent=err.message});
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
