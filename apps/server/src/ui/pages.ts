import { panels } from "../panels/registry";
import { activityDashboardScript } from "../panels/activity";
import { aiSecurityDashboardScript } from "../panels/ai-security-panel";
import { briefingDashboardScript } from "../panels/briefing";
import { dailyBriefingDashboardScript } from "../panels/daily-briefing-panel";
import { hobieDashboardScript } from "../panels/hobie";
import { calendarDashboardScript } from "../panels/calendar";
import { feedsDashboardScript } from "../panels/feeds";
import { hostHealthDashboardScript } from "../panels/host-health";
import { notesDashboardScript } from "../panels/notes";
import { recallioDashboardScript } from "../panels/recallio";
import { taggedNewsDashboardScript } from "../panels/tagged-news";
import { weatherDashboardScript } from "../panels/weather";
import { defaultDashboardLayout } from "../dashboard-layout/defaults";
import type { PanelLayoutEntry } from "../dashboard-layout/types";
import { dashboardGridScript } from "./dashboard-grid";
import type { NavLink } from "./layout";
import { page } from "./layout";

function panelGridStyle(entry: PanelLayoutEntry): string {
  const span = entry.collapsed ? 1 : entry.h;
  return `--gc-start:${entry.x + 1};--gc-span:${entry.w};--gr-start:${entry.y + 1};--gr-span:${span}`;
}

function panelItemAttrs(entry: PanelLayoutEntry): string {
  const collapsed = entry.collapsed ? " is-collapsed" : "";
  return `class="dashboard-item${collapsed}" data-full-h="${entry.h}"`;
}

const PANEL_PAGE_LINKS = Object.fromEntries(panels.filter((p) => p.pageHref).map((p) => [p.id, p.pageHref!]));

export function dashboardPage(nav?: NavLink[]): string {
  const layout = defaultDashboardLayout(panels.map((p) => p.id));
  const byId = new Map(layout.panels.map((p) => [p.id, p]));
  const sections = panels
    .map((p) => {
      const entry = byId.get(p.id)!;
      return `<div ${panelItemAttrs(entry)} data-panel-id="${p.id}" style="${panelGridStyle(entry)}">${p.dashboardHtml}</div>`;
    })
    .join("\n");
  return page({
    title: "Command center",
    active: "/",
    nav,
    body: `<div class="dashboard-page"><header class="page-header"><h1>Dashboard</h1><p class="dim">Daily tools in one place. Drag panel headers to rearrange; resize from the corner handle.</p></header>
<div class="dashboard-toolbar">
  <button type="button" class="ghost" id="dashboard-reset-layout">Reset layout</button>
  <p class="dim">Layout is saved on this server.</p>
</div>
<div class="dashboard-grid" id="dashboard-grid">${sections}</div></div>`,
    script: `var PANEL_PAGE_LINKS=${JSON.stringify(PANEL_PAGE_LINKS)};
${dashboardGridScript()}${activityDashboardScript()}${hobieDashboardScript()}${taggedNewsDashboardScript()}${dailyBriefingDashboardScript()}${aiSecurityDashboardScript()}${weatherDashboardScript()}${calendarDashboardScript()}${notesDashboardScript()}${feedsDashboardScript()}${briefingDashboardScript()}${hostHealthDashboardScript()}${recallioDashboardScript()}`,
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
<label class="row" style="margin:.5rem 0"><input type="radio" name="feedScope" value="all" id="scope-all"/> All feeds in News reader</label>
<label class="row" style="margin:.5rem 0"><input type="radio" name="feedScope" value="folders" id="scope-folders"/> Selected folders only</label>
<div id="scope-folder-list" class="dim" style="margin-left:1.25rem;font-size:.8125rem"></div>
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
        html+='<label class="row" style="margin:.25rem 0"><input type="checkbox" class="scope-folder" data-id="'+esc(id)+'"'+(checked?" checked":"")+'/> '+esc(prefix+f.name)+'</label>';
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
    var vis=t.locked?"":'<label class="row" style="margin:0;font-size:.8125rem"><input type="checkbox" class="tab-vis" data-id="'+esc(t.id)+'"'+(t.visible?" checked":"")+'/> Visible</label>';
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
