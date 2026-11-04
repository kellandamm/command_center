import type { NavLink } from "./layout";
import { settingsWorkspace } from "./settings-workspace";
import { settingsPageBody, SETTINGS_PAGE_TAB_SCRIPT } from "./pages-settings-body";

export { dashboardPage } from "./dashboard-page";

export function settingsPage(nav?: NavLink[]): string {
  return settingsWorkspace({
    category: "general", title: "General", description: "Workspace scope, timezone, and setup.", nav,
    body: settingsPageBody(),
    script: SETTINGS_PAGE_TAB_SCRIPT + `
var savedSettings=null,settingsRevision=null,settingsCanManage=false,settingsSections={},settingsConflict=null;
function clone(value){return JSON.parse(JSON.stringify(value));}
function readPref(path){return path.split(".").reduce(function(value,key){return value[key];},settingsState.viewPreferences);}
function writePref(path,value){var keys=path.split("."),target=settingsState.viewPreferences;keys.slice(0,-1).forEach(function(key){target=target[key];});target[keys[keys.length-1]]=value;}
function sectionPatch(id){
 if(id==="schedule")return {briefingTime:$("briefingTime").value};
 if(id==="topics")return {briefingTopics:$("briefingTopics").value.split(/\\r?\\n/).map(function(v){return v.trim();}).filter(Boolean)};
 if(id==="tabs")return {sidebarTabs:clone(settingsState.sidebarTabs)};
 if(id==="briefing")return {viewPreferences:{briefing:clone(settingsState.viewPreferences.briefing)}};
 if(id==="calendar")return {viewPreferences:{calendar:clone(settingsState.viewPreferences.calendar)}};
 return {viewPreferences:{density:settingsState.viewPreferences.density,notes:clone(settingsState.viewPreferences.notes),hobie:clone(settingsState.viewPreferences.hobie),activity:clone(settingsState.viewPreferences.activity)}};
}
function savedPatch(id){
 var draft=sectionPatch(id);
 if(draft.viewPreferences){Object.keys(draft.viewPreferences).forEach(function(key){draft.viewPreferences[key]=clone(savedSettings.viewPreferences[key]);});}
 else Object.keys(draft).forEach(function(key){draft[key]=clone(savedSettings[key]);});
 return draft;
}
function sectionDirty(id){return savedSettings&&JSON.stringify(sectionPatch(id))!==JSON.stringify(savedPatch(id));}
function updateSectionActions(id){
 var section=settingsSections[id],dirty=sectionDirty(id),actions=$("actions-"+id);
 actions.hidden=!dirty&&!section.pending&&!$("saved-"+id).textContent;
 $("f-"+id).querySelectorAll("input,select,textarea,button").forEach(function(el){el.disabled=!settingsCanManage||section.pending||!!settingsConflict||(el.dataset.locked==="true");});
 $(id+"-save").disabled=!settingsCanManage||!dirty||section.pending||!!settingsConflict;
 document.querySelector('[data-cancel="'+id+'"]').disabled=!settingsCanManage||!dirty||section.pending;
}
function bindPreferences(){
 document.querySelectorAll("[data-pref]").forEach(function(input){
   var value=readPref(input.dataset.pref);if(input.type==="checkbox")input.checked=!!value;else input.value=String(value);
   input.onchange=function(){writePref(input.dataset.pref,input.type==="checkbox"?input.checked:input.dataset.pref==="activity.limit"?Number(input.value):input.value);};
 });
}
function renderTabsEditor(){
 var box=$("tabs-editor");box.replaceChildren();
 settingsState.sidebarTabs.slice().sort(function(a,b){return a.order-b.order;}).forEach(function(tab,index,rows){
  var row=element("div",undefined,"settings-row"),labelBox=element("div"),input=element("input");
  input.type="text";input.value=tab.label;input.maxLength=48;input.required=true;input.setAttribute("aria-label","Label for "+tab.id);input.disabled=tab.locked;input.dataset.locked=String(!!tab.locked);
  input.oninput=function(){tab.label=input.value;};labelBox.appendChild(input);
  var controls=element("div",undefined,"row");
  if(!tab.locked){var label=element("label",undefined,"row"),visible=element("input");visible.type="checkbox";visible.checked=tab.visible;visible.onchange=function(){tab.visible=visible.checked;};label.append(visible,document.createTextNode("Visible"));controls.appendChild(label);}
  else controls.appendChild(element("span","Always visible","dim"));
  ["up","down"].forEach(function(direction){
   var button=element("button",direction==="up"?"↑":"↓","ghost"),other=index+(direction==="up"?-1:1);
   button.type="button";button.setAttribute("aria-label","Move "+tab.label+" "+direction);button.dataset.locked=String(other<0||other>=rows.length);
   button.onclick=function(){if(other<0||other>=rows.length)return;var order=tab.order;tab.order=rows[other].order;rows[other].order=order;renderTabsEditor();updateSectionActions("tabs");var focus=$("tabs-editor").querySelector('[aria-label="Move '+CSS.escape(tab.label)+" "+direction+'"]');if(focus)focus.focus();};
   controls.appendChild(button);
  });row.append(labelBox,controls);box.appendChild(row);
 });
}
function restoreSection(id){
 var patch=savedPatch(id);
 if(patch.viewPreferences)Object.keys(patch.viewPreferences).forEach(function(key){settingsState.viewPreferences[key]=clone(patch.viewPreferences[key]);});
 if(id==="schedule")$("briefingTime").value=patch.briefingTime;
 if(id==="topics")$("briefingTopics").value=patch.briefingTopics.join("\\n");
 if(id==="tabs"){settingsState.sidebarTabs=clone(patch.sidebarTabs);renderTabsEditor();}
 bindPreferences();$("saved-"+id).textContent="";updateSectionActions(id);
}
function renderRows(box,rows){box.replaceChildren();var dl=element("dl");rows.forEach(function(row){dl.append(element("dt",row[0]),element("dd",String(row[1])));});box.appendChild(dl);}
function renderSummary(response){
 var runtime=response.runtime,providers=response.briefingProviders||{},ntfy=response.ntfy||{},meta=response.meta||{};
 $("schedule-timezone").textContent=runtime?"Server timezone: "+runtime.timezone+". Not your browser timezone.":"Server timezone unavailable. Review deployment before changing the schedule.";
 renderRows($("settings-general-summary"),[["Server timezone",runtime?runtime.timezone:"Unavailable"],["Preference scope","Shared on this server"],["Daily briefing",savedSettings.briefingTime+(runtime?" in "+runtime.timezone:"")],["Followed topics",savedSettings.briefingTopics.length?savedSettings.briefingTopics.join(", "):"None - keyword searches are off"]]);
 $("settings-setup-status").textContent=providers.search&&providers.summarizer?"Briefing search and AI are configured. Access has not been verified by this page.":"Briefing setup needs attention: "+[!providers.search?"Brave Search":"",!providers.summarizer?"AI summarizer":""].filter(Boolean).join(" and ")+".";
 $("topics-providers").textContent=providers.search&&providers.summarizer?"Search and AI are configured. Verify provider access in Connections.":$("settings-setup-status").textContent;
 $("ntfy-status").textContent=ntfy.enabled?"Configured · topic "+(ntfy.topicMasked||"(hidden)"):"Not configured · add a topic in Connections or deployment configuration.";
 $("ntfy-test").disabled=!(ntfy.enabled&&ntfy.canTest);$("ntfy-owner-hint").hidden=!(ntfy.enabled&&!ntfy.canTest);
 renderRows($("ntfy-details"),[["Timezone",runtime?runtime.timezone:"Unavailable"],["Quiet hours",ntfy.quietHours===undefined?"Unavailable":ntfy.quietHours||"Not configured"],["Reminder lead time",ntfy.reminderMinutes===undefined?"Unavailable":ntfy.reminderMinutes+" minutes"],["Coaching notifications",ntfy.coachEnabled===undefined?"Unavailable":ntfy.coachEnabled?"Enabled":"Disabled"],["Daily briefing","Bypasses quiet hours"]]);
 var rows=[];
 if(runtime){var access=runtime.access||{},agents=runtime.agents||{},calendar=runtime.calendar||{},integrations=runtime.integrations||{};
  rows=[["Server version",runtime.version],["Timezone",runtime.timezone],["Weather",runtime.weather.provider+" · "+runtime.weather.latitude+", "+runtime.weather.longitude],["GitHub author",runtime.githubUsername],["Calendars",calendar.native+" native / "+calendar.subscriptions+" subscriptions / "+calendar.environmentFeeds+" deployment feeds"],["Authentication",[access.cloudflare?"Cloudflare Access":"",access.adminToken?"Admin token":"",access.insecureNoAuth?"WARNING: unauthenticated access allowed":""].filter(Boolean).join("; ")||"Not configured"],["Provider management",access.canManageConnections?"Verified owner":"Requires verified owner login"],["Encrypted credential storage",access.encryptedStorage?"Enabled":"Disabled"],["Agent access",agents.mcpClients+" bearer clients / "+agents.cloudflareClients+" Cloudflare mappings"],["Agent queue limit",agents.maxPendingTasks+" pending tasks"],["Hobie polling / webhook",(agents.hobiePoll?"Configured":"Off")+" / "+(agents.webhook?"Configured":"Off")],["Todoist",integrations.todoist?"Configured for agent task creation, not board sync":"Not configured"],["Recallio",integrations.recallio?"Configured for memory search":"Not configured"],["Docker",integrations.docker?"Socket configured - access checked when loaded":"Disabled"]];
 }else rows=[["Deployment configuration","Unavailable. Retry loading Settings."]];
 renderRows($("settings-overview"),rows);
 var features=meta.features||{};
 renderRows($("settings-features-list"),[["Whiteboard",features.whiteboardEnabled?"On":"Off"],["Share links",features.shareLinksEnabled?"On":"Off"],["Encrypted API key storage",meta.connectionsStorage?"On":"Off"],["Owner-only shared settings",meta.ownerEmailsConfigured?"On":"Off - any signed-in session including ADMIN_TOKEN can edit shared preferences"]]);
}
var loadedResponse=null;
async function refreshSettingsNavigation(){
 var response=await fetch("/settings",{headers:{"x-ah":"1"}});
 if(!response.ok)throw new Error("HTTP "+response.status);
 var current=new DOMParser().parseFromString(await response.text(),"text/html"),sidebar=current.querySelector(".sidebar-content"),existing=document.querySelector(".sidebar-content");
 if(!sidebar||!existing)throw new Error("Sidebar markup is unavailable");
 existing.replaceChildren.apply(existing,Array.from(sidebar.childNodes));
}
async function loadSettings(){
 $("settings-editor").disabled=true;$("settings-retry").hidden=true;$("settings-load-status").textContent="Loading current settings...";
 var response=await api("/api/settings");loadedResponse=response;savedSettings=clone(response.settings);settingsRevision=response.revision;
 settingsState.sidebarTabs=clone(savedSettings.sidebarTabs);settingsState.viewPreferences=clone(savedSettings.viewPreferences);
 $("briefingTime").value=savedSettings.briefingTime;$("briefingTopics").value=savedSettings.briefingTopics.join("\\n");
 settingsCanManage=!(response.meta&&response.meta.canManage===false);
 $("settings-manage-hint").hidden=settingsCanManage;$("settings-manage-hint").textContent=ownerViewOnlyHint(response.meta)||"View-only. Sign in with permission to manage shared settings.";
 renderTabsEditor();bindPreferences();renderSummary(response);$("settings-editor").disabled=false;
 Object.keys(settingsSections).forEach(updateSectionActions);
 $("settings-load-status").textContent="Current settings loaded. Shared changes take effect after saving.";
}
async function saveSection(id){
 var section=settingsSections[id];if(section.pending||!settingsCanManage||!sectionDirty(id)||settingsConflict)return;
 var patch=sectionPatch(id),status=$("saved-"+id);
 if(id==="topics"&&(patch.briefingTopics.length>10||patch.briefingTopics.some(function(t){return t.length>120;}))){status.textContent="Use up to 10 topics, no more than 120 characters each.";updateSectionActions(id);return;}
 section.pending=true;status.textContent="Saving...";updateSectionActions(id);
 try{
  var response=await api("/api/settings","PUT",Object.assign({},patch,{expectedRevision:settingsRevision}));
  settingsRevision=response.revision;savedSettings=clone(response.settings);
  document.documentElement.classList.toggle("compact",savedSettings.viewPreferences.density==="compact");
  if(patch.viewPreferences)Object.keys(patch.viewPreferences).forEach(function(key){settingsState.viewPreferences[key]=clone(savedSettings.viewPreferences[key]);});
  if(id==="topics")$("briefingTopics").value=savedSettings.briefingTopics.join("\\n");
  if(id==="schedule")$("briefingTime").value=savedSettings.briefingTime;
  if(id==="tabs"){settingsState.sidebarTabs=clone(savedSettings.sidebarTabs);renderTabsEditor();}
  bindPreferences();renderSummary(loadedResponse);status.textContent="Saved.";
  if(id==="tabs"){try{await refreshSettingsNavigation();}catch(navError){status.textContent="Saved. Sidebar could not refresh: "+navError.message+". Open another page to load the updated navigation.";}}
 }catch(error){
  status.textContent=error.message||"Could not save. Your draft is unchanged.";
  if(String(error.message).includes("changed elsewhere")){
   try{var current=await api("/api/settings");settingsConflict=current;$("settings-conflict-current").textContent=JSON.stringify(current.settings,null,2);$("settings-conflict").hidden=false;}catch(reviewError){status.textContent+=" Current settings could not load: "+reviewError.message;}
  }
 }finally{section.pending=false;Object.keys(settingsSections).forEach(updateSectionActions);}
}
["views","tabs","schedule","topics","briefing","calendar"].forEach(function(id){
 var form=$("f-"+id);settingsSections[id]={pending:false};
 registerSettingsDraft(id,{dirty:function(){return sectionDirty(id);},get pending(){return settingsSections[id].pending;},reset:function(){restoreSection(id);}});
 form.addEventListener("input",function(){if(savedSettings){$("saved-"+id).textContent="";updateSectionActions(id);}});
 form.addEventListener("change",function(){if(savedSettings)updateSectionActions(id);});
 form.onsubmit=function(event){event.preventDefault();saveSection(id);};
 form.querySelector("[data-cancel]").onclick=function(){restoreSection(id);};
});
$("settings-conflict-reload").onclick=function(){if(!settingsConflict)return;settingsConflict=null;$("settings-conflict").hidden=true;reloadSettings();};
$("settings-conflict-keep").onclick=function(){if(!settingsConflict)return;savedSettings=clone(settingsConflict.settings);settingsRevision=settingsConflict.revision;loadedResponse=settingsConflict;settingsConflict=null;$("settings-conflict").hidden=true;Object.keys(settingsSections).forEach(updateSectionActions);message("Current version reviewed. Your draft is retained; save the section when ready.");};
var notificationPending=false;
$("ntfy-test").onclick=async function(){
 if(notificationPending)return;notificationPending=true;this.disabled=true;$("ntfy-test-status").textContent="Sending...";
 try{var result=await api("/api/notify/test","POST",{});$("ntfy-test-status").textContent=result.ok?"Sent. Check your phone.":"Server could not reach ntfy.";}
 catch(error){$("ntfy-test-status").textContent=error.message||"Could not send test.";}
 finally{notificationPending=false;this.disabled=!(loadedResponse&&loadedResponse.ntfy&&loadedResponse.ntfy.enabled&&loadedResponse.ntfy.canTest);}
};
function reloadSettings(){loadSettings().catch(function(error){$("settings-editor").disabled=true;$("settings-load-status").textContent=error.message||"Could not load Settings. Editing is disabled.";$("settings-retry").hidden=false;});}
$("settings-retry").onclick=reloadSettings;reloadSettings();
`,
  });
}
