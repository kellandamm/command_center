import type { NavLink } from "./layout";
import { page } from "./layout";

export function activityPage(nav?: NavLink[]): string {
  return page({
    title: "Activity — Command center",
    active: "/activity",
    nav,
    body: `<header class="page-header"><h1>Activity</h1><p class="dim">Updates from external agents (MCP / webhooks).</p></header>
<div class="card"><button type="button" class="ghost" id="activity-refresh" style="margin-bottom:.75rem">Refresh</button>
<ul id="activity-full-list" class="todoist-list"></ul></div>`,
    script: `
function renderActivityFull(rows){
  var el=document.getElementById("activity-full-list");
  if(!rows||!rows.length){el.innerHTML='<li class="dim">No agent updates yet.</li>';return;}
  el.innerHTML=rows.map(function(u){
    var t=new Date(u.createdAt).toLocaleString();
    return '<li class="todoist-item"><div class="dim">'+esc(u.panel)+' · '+esc(u.clientId)+' · '+esc(t)+'</div><div style="white-space:pre-wrap">'+esc(u.markdown)+'</div></li>';
  }).join("");
}
var activityLimit=200;
function loadActivityFull(){return api("/api/activity/updates?limit="+activityLimit).then(function(r){renderActivityFull(r.updates)})}
document.getElementById("activity-refresh").onclick=loadActivityFull;
window.viewPreferencesReady.then(function(prefs){
  activityLimit=prefs&&prefs.activity&&prefs.activity.limit||200;
  loadActivityFull();
});
`,
  });
}
