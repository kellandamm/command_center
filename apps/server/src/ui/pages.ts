import type { NavLink } from "./layout";
import { page } from "./layout";

export { dashboardPage } from "./dashboard-page";

export function settingsPage(nav?: NavLink[]): string {
  return page({
    title: "Settings",
    active: "/settings",
    nav,
    body: `<header class="page-header"><h1>Settings</h1><p class="dim">Tune schedules, view behavior, and navigation.</p></header>
<p><a href="/settings/connections">Manage service connections and keys</a></p>
<p><a href="/settings/calendars">Manage calendars and subscriptions</a></p>
<div class="settings-tabs" role="tablist">
  <button type="button" class="ghost on" data-tab="views">Views</button>
  <button type="button" class="ghost" data-tab="topics">Briefing topics</button>
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
<label class="row choice-row"><input type="checkbox" data-pref="briefing.topics"/> Keyword digest</label><label class="row choice-row"><input type="checkbox" data-pref="briefing.weather"/> Weather</label><label class="row choice-row"><input type="checkbox" data-pref="briefing.calendar"/> Calendar</label></fieldset>
<div class="settings-option"><label for="pref-hobie-status">Hobie queue filter</label><select id="pref-hobie-status" data-pref="hobie.status"><option value="all">All tasks</option><option value="pending">Pending</option><option value="claimed">Claimed</option><option value="done">Done</option></select></div>
<div class="settings-option"><label for="pref-calendar-week">Calendar week starts on</label><select id="pref-calendar-week" data-pref="calendar.weekStartsOn"><option value="monday">Monday</option><option value="sunday">Sunday</option></select></div>
<div class="settings-option"><label for="pref-activity-limit">Activity entries</label><select id="pref-activity-limit" data-pref="activity.limit"><option value="25">25</option><option value="50">50</option><option value="100">100</option><option value="200">200</option></select></div>
<div class="settings-option"><label for="pref-notes-size">Notes text size</label><select id="pref-notes-size" data-pref="notes.fontSize"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></div>
</div>
<div class="row" style="margin-top:1rem"><button type="button" id="views-save">Save view preferences</button><span id="saved-views" class="dim"></span></div>
</div>
<div class="card settings-card settings-tab-panel" id="tab-topics">
<h2>Briefing topics</h2>
<p>Follow what matters to you. Your daily edition searches the web for each keyword or phrase and summarizes recent results with source links.</p>
<p class="dim">Searches cover the past 24 hours, not RSS feeds. AI digests use search excerpts, not full articles. These topics are shared across this server.</p>
<p id="topics-providers" role="status">Checking search and summarizer configuration...</p>
<form id="f-topics">
<label for="briefingTopics">Keywords and phrases</label>
<textarea id="briefingTopics" rows="8" maxlength="1210" placeholder="Microsoft Fabric&#10;AI agent security&#10;Chicago technology" aria-describedby="topics-hint"></textarea>
<p id="topics-hint" class="dim">One topic per line. Up to 10 topics, 120 characters each. Remove a line to stop following it. Leave blank to turn off keyword searches.</p>
<div class="row"><button type="submit" id="topics-save" disabled>Save topics</button><span id="saved-topics" role="status"></span></div>
</form>
<p class="dim">Saved topics apply to the next scheduled edition. To use them now, open <a href="/briefing">Daily Briefing</a> and choose Refresh edition.</p>
</div>
<div class="card settings-card settings-tab-panel" id="tab-schedule">
<form id="f-schedule">
<p class="dim">Prepare your keyword digest, calendar, and weather once a day at this time in the server's configured timezone.</p>
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
function showHashTab(){var name=location.hash.slice(1);if(["views","topics","schedule","tabs"].includes(name))showTab(name)}
window.addEventListener("hashchange",showHashTab);showHashTab();
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
    document.getElementById("briefingTopics").value=(s.briefingTopics||[]).join("\\n");
    var providers=r.briefingProviders||{};
    document.getElementById("topics-providers").textContent=providers.search&&providers.summarizer
      ?"Brave Search and AI summarizer are ready."
      :"Connection setup needed: "+[!providers.search?"Brave Search (BRAVE_SEARCH_API_KEY)":"",!providers.summarizer?"AI summarizer (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL)":""].filter(Boolean).join("; ")+". Open service connections to configure keys, or use deployment environment variables.";
    document.getElementById("topics-save").disabled=false;
    renderTabsEditor();bindViewPreferences();
  });
}
document.getElementById("f-topics").onsubmit=function(e){
  e.preventDefault();
  var status=document.getElementById("saved-topics"),button=document.getElementById("topics-save");
  var topics=document.getElementById("briefingTopics").value.split(/\\r?\\n/).map(function(s){return s.trim()}).filter(Boolean);
  if(topics.length>10||topics.some(function(s){return s.length>120})){status.textContent="Use up to 10 topics, with no more than 120 characters each.";return}
  button.disabled=true;status.textContent="Saving...";
  api("/api/settings","PUT",{briefingTopics:topics}).then(function(r){
    document.getElementById("briefingTopics").value=r.settings.briefingTopics.join("\\n");status.textContent="Topics saved.";
  }).catch(function(err){status.textContent=err.message||"Could not save topics."}).finally(function(){button.disabled=false});
};
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
loadSettings().catch(function(err){document.getElementById("topics-providers").textContent=err.message||"Could not load Settings. Reload to retry."});
`,
  });
}
