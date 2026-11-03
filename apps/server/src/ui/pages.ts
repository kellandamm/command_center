import type { NavLink } from "./layout";
import { page } from "./layout";
import { PHASE2_PAGE_CSS } from "./phase2-pages-css";
import { settingsPageBody, SETTINGS_PAGE_TAB_SCRIPT } from "./pages-settings-body";

export { dashboardPage } from "./dashboard-page";

export function settingsPage(nav?: NavLink[]): string {
  return page({
    title: "Settings",
    active: "/settings",
    nav,
    extraCss: PHASE2_PAGE_CSS,
    body: settingsPageBody(),
    script: SETTINGS_PAGE_TAB_SCRIPT + `
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
function featureBadge(on){
  return on
    ?'<span class="ui-badge ui-badge-soft ui-badge-ok">On</span>'
    :'<span class="ui-badge ui-badge-soft ui-badge-neutral">Off</span>';
}
function addFeatureRow(list,label,on,offHint,onHint){
  var row=document.createElement("div");
  row.className="settings-feature-row";
  var top=document.createElement("div");
  top.className="settings-feature-top";
  top.innerHTML='<span class="settings-feature-label">'+esc(label)+'</span><span class="settings-feature-status">'+featureBadge(on)+'</span>';
  row.appendChild(top);
  var hint=on?onHint:offHint;
  if(hint){var p=document.createElement("p");p.className="settings-feature-hint dim";p.textContent=hint;row.appendChild(p);}
  list.appendChild(row);
}
function renderDeploymentFeatures(meta){
  var list=document.getElementById("settings-features-list");
  if(!list)return;
  list.replaceChildren();
  var features=(meta&&meta.features)||{};
  var ownerOn=!!(meta&&meta.ownerEmailsConfigured);
  addFeatureRow(list,"Whiteboard",!!features.whiteboardEnabled,"Set WHITEBOARD_ENABLED=true to enable the Whiteboard page and API.",null);
  addFeatureRow(list,"Share links",!!features.shareLinksEnabled,"Set SHARE_LINKS_ENABLED=true to enable note share links. Public share URLs also need the Cloudflare Access bypass in docs/share-links.md.",null);
  addFeatureRow(list,"Encrypted API key storage",!!(meta&&meta.connectionsStorage),"Set CONNECTIONS_MASTER_KEY (64 hex chars, openssl rand -hex 32) and restart to save API keys in Service connections. Back it up: saved keys can't be decrypted without it.",null);
  addFeatureRow(list,"Owner-only shared settings",ownerOn,"OWNER_EMAILS is not set; any signed-in session including ADMIN_TOKEN can edit shared settings on this server.","OWNER_EMAILS is set; shared settings, dashboard layout writes, and capture tokens require an owner login or ADMIN_TOKEN.");
}
function renderNtfy(ntfy){
  var status=document.getElementById("ntfy-status");
  var btn=document.getElementById("ntfy-test");
  var ownerHint=document.getElementById("ntfy-owner-hint");
  if(!status||!btn)return;
  if(ntfy&&ntfy.enabled){
    status.textContent="On · topic "+(ntfy.topicMasked||"••••");
  }else{
    status.textContent="Off · set NTFY_TOPIC (or ntfy connection) and restart the server.";
  }
  var canTest=!!(ntfy&&ntfy.enabled&&ntfy.canTest);
  btn.disabled=!canTest;
  if(ownerHint){
    ownerHint.hidden=!(ntfy&&ntfy.enabled&&!ntfy.canTest);
  }
}
function setSettingsReadOnly(meta){
  var readOnly=!(meta&&meta.canManage!==false);
  var hint=document.getElementById("settings-manage-hint");
  ["views-save","tabs-save"].forEach(function(id){var el=document.getElementById(id);if(el)el.disabled=readOnly;});
  var schedule=document.getElementById("f-schedule");if(schedule)schedule.querySelectorAll("input,button").forEach(function(node){node.disabled=readOnly;});
  var topics=document.getElementById("f-topics");if(topics)topics.querySelectorAll("textarea,button").forEach(function(node){node.disabled=readOnly;});
  document.querySelectorAll("#tab-views [data-pref]").forEach(function(el){el.disabled=readOnly;});
  document.querySelectorAll("#tabs-editor .tab-vis,#tabs-editor .tab-label:not([disabled]),#tabs-editor .tab-up:not([disabled]),#tabs-editor .tab-down:not([disabled])").forEach(function(el){el.disabled=readOnly;});
  if(readOnly){hint.hidden=false;hint.textContent=ownerViewOnlyHint(meta)||"View-only: set OWNER_EMAILS and sign in as an owner to change schedules, topics, tabs, and view preferences on this server.";}
  else hint.hidden=true;
}
function loadSettings(){
  document.getElementById("settings-editor").disabled=true;
  document.getElementById("settings-retry").hidden=true;
  document.getElementById("settings-load-status").textContent="Loading current settings...";
  return api("/api/settings").then(function(r){
    var s=r.settings;
    settingsState.sidebarTabs=s.sidebarTabs||[];
    settingsState.viewPreferences=s.viewPreferences||{};
    document.getElementById("briefingTime").value=s.briefingTime;
    document.getElementById("briefingTopics").value=(s.briefingTopics||[]).join("\\n");
    var providers=r.briefingProviders||{};
    document.getElementById("topics-providers").textContent=providers.search&&providers.summarizer
      ?"Brave Search and AI summarizer are configured. Check service connections to verify access."
      :"Connection setup needed: "+[!providers.search?"Brave Search (BRAVE_SEARCH_API_KEY)":"",!providers.summarizer?"AI summarizer (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL)":""].filter(Boolean).join("; ")+". Open service connections to configure keys, or use deployment environment variables.";
    renderDeploymentFeatures(r.meta||{});
    var meta=r.meta||{};
    renderNtfy(r.ntfy);
    settingsState.renderOverview=function(s){
    var runtime=r.runtime;
    document.getElementById("schedule-timezone").textContent=runtime?"Server timezone: "+runtime.timezone+". This is not necessarily your browser's timezone.":"Server timezone unavailable. Reload to check before changing the schedule.";
    var rows=[
      ["Daily briefing",s.briefingTime+(runtime?" in "+runtime.timezone:" (timezone unavailable)")],
      ["Followed topics",s.briefingTopics.length?s.briefingTopics.join(", "):"None - keyword searches are off"],
      ["Keyword digest",!s.briefingTopics.length?"Off - no topics":providers.search&&providers.summarizer?"Configured - access not verified":"Blocked - configure Brave Search and AI summarizer"],
      ["Page density",s.viewPreferences.density],
      ["Briefing sections",Object.keys(s.viewPreferences.briefing).filter(function(key){return s.viewPreferences.briefing[key];}).join(", ")||"None"],
      ["Calendar week starts",s.viewPreferences.calendar.weekStartsOn],
      ["Agent queue / activity",s.viewPreferences.hobie.status+" / "+s.viewPreferences.activity.limit+" entries"],
      ["Notes text size",s.viewPreferences.notes.fontSize],
      ["Visible sidebar tabs",s.sidebarTabs.filter(function(tab){return tab.visible;}).sort(function(a,b){return a.order-b.order;}).map(function(tab){return tab.label;}).join(", ")]
    ];
    rows.push(["AI features",providers.summarizer?"Configured - Service connections can check access, but cannot guarantee model support":"Unavailable - configure the AI summarizer"],
      ["Briefing web search",providers.search?"Configured - provider access must be tested in Service connections":"Unavailable - configure Brave Search"]);
    if(runtime){
      var access=runtime.access,agents=runtime.agents,calendar=runtime.calendar;
      rows.push(["Server version",runtime.version],["Weather (deployment)",runtime.weather.provider+" at "+runtime.weather.latitude+", "+runtime.weather.longitude+"; no API key required"],
        ["GitHub author (deployment)",runtime.githubUsername+(runtime.integrations&&runtime.integrations.github?"; hourly merged PR import configured":"; merged PR import unavailable without a token")],
        ["Calendars",calendar.native+" enabled native / "+calendar.subscriptions+" enabled subscriptions / "+calendar.environmentFeeds+" deployment feeds; subscription access is checked when calendars load"],
        ["Authentication (deployment)",[access.cloudflare?"Cloudflare Access":null,access.adminToken?"Admin token":null,access.insecureNoAuth?"WARNING: unauthenticated access is allowed":null].filter(Boolean).join("; ")||"No authentication configured"],
        ["Connection management",access.canManageConnections?"Verified owner - provider settings are available":"Read-only deployment summary - sign in as a configured owner through Cloudflare Access to manage provider settings"],
        ["Encrypted credential storage",access.encryptedStorage?"Enabled":"Disabled - set CONNECTIONS_MASTER_KEY to save provider secrets"],
        ["Agent access (deployment)",agents.mcpClients+" bearer clients / "+agents.cloudflareClients+" Cloudflare mappings; Hobie polling "+(agents.hobiePoll?"configured":"not configured")+"; webhook "+(agents.webhook?"configured":"not configured")],
        ["Agent queue limit (deployment)",agents.maxPendingTasks+" pending tasks across all clients"]
      );
      if(runtime.integrations)rows.push(
        ["Todoist task creation",runtime.integrations.todoist?"Token configured - used by agents/MCP and webhook, not a board sync":"Unavailable - no token configured"],
        ["Recallio memory search",runtime.integrations.recallio?"Endpoint configured - check required credentials and access in Service connections":"Unavailable - no endpoint configured"],
        ["Docker panel (deployment)",runtime.integrations.docker?"Socket configured - access is checked when the panel loads":"Disabled - no socket configured"]
      );
    }
    document.getElementById("settings-overview").innerHTML='<dl>'+rows.map(function(row){return '<dt style="font-weight:600;margin-top:1rem">'+esc(row[0])+'</dt><dd style="margin:.25rem 0">'+esc(String(row[1]))+'</dd>';}).join("")+'</dl>';
    };
    settingsState.renderOverview(s);
    document.getElementById("settings-editor").disabled=false;
    document.getElementById("settings-load-status").textContent=r.runtime?"Current settings loaded from this server. Unsaved edits do not change this summary.":"Preferences loaded; deployment summary is unavailable.";
    renderTabsEditor();bindViewPreferences();
    setSettingsReadOnly(meta);
  });
}
document.getElementById("f-topics").onsubmit=function(e){
  e.preventDefault();
  var status=document.getElementById("saved-topics"),button=document.getElementById("topics-save");
  var topics=document.getElementById("briefingTopics").value.split(/\\r?\\n/).map(function(s){return s.trim()}).filter(Boolean);
  if(topics.length>10||topics.some(function(s){return s.length>120})){status.textContent="Use up to 10 topics, with no more than 120 characters each.";return}
  button.disabled=true;status.textContent="Saving...";
  api("/api/settings","PUT",{briefingTopics:topics}).then(function(r){
    document.getElementById("briefingTopics").value=r.settings.briefingTopics.join("\\n");settingsState.renderOverview(r.settings);status.textContent="Topics saved.";
  }).catch(function(err){status.textContent=err.message||"Could not save topics."}).finally(function(){button.disabled=false});
};
document.getElementById("f-schedule").onsubmit=function(e){e.preventDefault();
  saveSettingsSection("saved-schedule",{briefingTime:document.getElementById("briefingTime").value});
};
document.getElementById("views-save").onclick=function(){
  saveSettingsSection("saved-views",{viewPreferences:settingsState.viewPreferences});
};
document.getElementById("tabs-save").onclick=function(){
  saveSettingsSection("saved-tabs",{sidebarTabs:settingsState.sidebarTabs});
};
var ntfyBtn=document.getElementById("ntfy-test");
if(ntfyBtn)ntfyBtn.onclick=function(){
  var status=document.getElementById("ntfy-test-status");
  if(status)status.textContent="Sending…";
  api("/api/notify/test","POST",{}).then(function(r){
    if(status)status.textContent=r.ok?"Sent. Check your phone.":"Server could not reach ntfy.";
  }).catch(function(err){if(status)status.textContent=err.message||"Could not send test."});
};
function saveSettingsSection(statusId,patch){
  var status=document.getElementById(statusId),editor=document.getElementById("settings-editor");
  status.textContent="Saving...";editor.disabled=true;
  api("/api/settings","PUT",patch).then(function(){status.textContent="Saved";location.reload();})
    .catch(function(err){status.textContent=err.message||"Could not save settings. Your draft is unchanged.";editor.disabled=false;});
}
function reloadSettings(){loadSettings().catch(function(err){
  document.getElementById("settings-editor").disabled=true;
  document.getElementById("settings-load-status").textContent=err.message||"Could not load Settings. Editing is disabled to avoid overwriting current preferences.";
  document.getElementById("settings-retry").hidden=false;
});}
document.getElementById("settings-retry").onclick=reloadSettings;reloadSettings();
`,
  });
}
