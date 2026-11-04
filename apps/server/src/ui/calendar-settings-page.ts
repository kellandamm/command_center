import type { NavLink } from "./layout";
import { settingsWorkspace } from "./settings-workspace";

export function calendarSettingsPage(nav?: NavLink[]) {
  return settingsWorkspace({
    category: "calendars", title: "Calendars", nav,
    description: "Bring your calendars together. Keep subscriptions read-only or create a calendar you can edit here.",
    body: `<p><a href="/calendar">Open Calendar</a></p>
<form id="calendar-display" class="settings-group"><h3>Display defaults</h3><div class="settings-row"><div><label for="calendar-week-start">Week starts on</label><p class="dim">Shared preference</p></div><select id="calendar-week-start" disabled><option value="monday">Monday</option><option value="sunday">Sunday</option></select></div><div class="settings-actions"><button id="calendar-display-save" type="submit" disabled>Save changes</button><button id="calendar-display-cancel" type="button" class="ghost" disabled>Cancel</button><button id="calendar-display-retry" type="button" class="ghost" hidden>Retry display settings</button><span id="calendar-display-status" role="status">Loading display preference...</span></div></form>
<p id="calendar-settings-status" role="status">Loading calendar settings...</p>
<button id="calendar-settings-retry" type="button" class="ghost" hidden>Retry calendars</button>
<section id="google-calendar-settings" class="workspace-details">
<h2>Google Calendar</h2>
<p id="google-calendar-status" role="status">Checking Google Calendar connection...</p>
<div id="google-calendar-actions" class="row"></div>
<div id="google-calendar-list"></div>
</section>
<details id="calendar-create-panel" hidden><summary>Add a calendar</summary><form id="calendar-add" class="workspace-form" hidden>
<label for="calendar-kind">Type</label><select id="calendar-kind"><option value="native">Stremmy calendar</option><option value="ics">Existing calendar (ICS subscription)</option></select>
<label for="calendar-name">Name</label><input id="calendar-name" maxlength="120" required placeholder="Personal, work, focus...">
<label for="calendar-color">Color</label><input id="calendar-color" type="color" value="#2767ad">
<div id="calendar-url-field" hidden><label for="calendar-url">Private HTTPS subscription URL</label><input id="calendar-url" type="password" autocomplete="off" maxlength="4096">
<p class="dim">The URL may contain a private access token. It is encrypted and never returned to the browser. A subscription is read-only; it does not enable editing in the original calendar.</p></div>
<div class="settings-actions"><button type="submit">Add calendar</button><button id="calendar-add-cancel" type="button" class="ghost">Cancel</button></div>
</form></details>
<div id="calendar-settings-list" class="workspace-details"></div>
<details><summary>About calendar sharing</summary><p class="dim">Sharing is off by default. A published link grants anyone holding it read access to all events, locations, and descriptions in that native calendar. External tools may refresh slowly. Revoke the link here to stop future access.</p>
<p class="dim">Behind Cloudflare Access, external subscriptions need a narrowly scoped edge policy for <code>/feeds/calendars/*.ics</code>. The app still checks each feed's revocable token; never bypass authentication for the whole site.</p>
</details><p id="calendar-feed-link" role="status" style="overflow-wrap:anywhere"></p>`,
    script: `
var calendarsState=null,calendarDrafts={},googleDraft=null;
var googleResult=new URLSearchParams(location.search).get("google");
function loadCalendarSettings(){
  return api("/api/calendars").then(function(data){
    calendarsState=data;
    if(googleResult==="connected")message("Google Calendar connected. Select the calendars to show.");
    else if(googleResult==="failed")message("Google sign-in did not complete. Check the OAuth client and redirect URI, then try again.",true);
    googleResult=null;
    $("calendar-settings-status").textContent=(data.canManage?"Manage calendars below.":"Sign in through Cloudflare Access as a configured owner to change calendars.")+" Timezone: "+data.timezone+(data.environmentFeeds?" · "+data.environmentFeeds+" deployment-managed feed(s).":"");
    $("calendar-add").hidden=!data.canManage;
    $("calendar-create-panel").hidden=!data.canManage;$("calendar-settings-retry").hidden=true;
    $("calendar-kind").options[1].disabled=!data.credentialsWritable;
    loadGoogleCalendarSettings(data);
    var box=$("calendar-settings-list"),retained={};
    box.querySelectorAll("[data-calendar-id]").forEach(function(section){var draft=calendarDrafts[section.dataset.calendarId];if(draft&&(draft.dirty()||draft.pending))retained[section.dataset.calendarId]=section;});
    box.replaceChildren();
    if(!data.calendars.length)box.append(element("p","No managed calendars yet. Create one above or connect an existing subscription.","dim"));
    data.calendars.forEach(function(calendar){
      if(retained[calendar.id]){box.appendChild(retained[calendar.id]);return;}
      var section=element("section",undefined,"workspace-details"),heading=element("h2",calendar.name);
      section.dataset.calendarId=calendar.id;
      section.append(heading,element("p",(calendar.kind==="native"?"Editable native calendar":"Read-only subscription")+(calendar.enabled?" · Enabled":" · Paused")+(calendar.kind==="native"?(calendar.sharing?" · Sharing enabled":" · Sharing off"):""),"dim"));
      var manageDetails=element("details"),manageSummary=element("summary","Manage "+calendar.name);manageDetails.appendChild(manageSummary);
      var actions=element("div",undefined,"row");
      if(calendar.kind==="native"){
        actions.append(appLink("Export .ics","/api/calendars/"+calendar.id+"/export.ics","btn ghost"));
        if(data.canManage){
          var file=element("input");file.type="file";file.accept=".ics,text/calendar";file.setAttribute("aria-label","Import ICS into "+calendar.name);
          file.onchange=function(){var selected=file.files[0];if(!selected)return;
            if(selected.size>1000000){message("ICS imports are limited to 1 MB.",true);return;}
            selected.text().then(function(ics){return api("/api/calendars/"+calendar.id+"/import","POST",{ics:ics});}).then(function(result){message("Imported "+result.imported+" events. Existing duplicates were skipped.");file.value="";}).catch(fail);
          };actions.appendChild(file);
          var share=element("button",calendar.sharing?"Replace sharing link":"Enable sharing","ghost");share.type="button";
          share.onclick=function(){
            if(!confirm("Publish all events, locations, and descriptions in "+calendar.name+" to anyone with the link? Any previous sharing link will be revoked."))return;
            busy(share,async function(){
              var result=await api("/api/calendars/"+calendar.id+"/sharing","POST",{expectedVersion:calendar.version});
              $("calendar-feed-link").textContent="Copy this private subscription link now; it will not be shown again: "+new URL(result.path,location.origin).href;
              await loadCalendarSettings();
            });
          };actions.appendChild(share);
          if(calendar.sharing){var revoke=element("button","Revoke sharing","ghost");revoke.type="button";revoke.onclick=function(){
            if(!confirm("Revoke the public sharing link for "+calendar.name+"? Subscribers will lose future access."))return;
            busy(revoke,async function(){await api("/api/calendars/"+calendar.id+"/sharing","DELETE",{expectedVersion:calendar.version});$("calendar-feed-link").textContent="Sharing link revoked.";await loadCalendarSettings();});
          };actions.appendChild(revoke);}
        }
      }
      if(data.canManage){
        var toggle=element("button",calendar.enabled?"Pause calendar":"Enable calendar","ghost");toggle.type="button";toggle.onclick=function(){
          busy(toggle,async function(){await api("/api/calendars/"+calendar.id,"PUT",{expectedVersion:calendar.version,enabled:!calendar.enabled});await loadCalendarSettings();});
        };actions.appendChild(toggle);
        var rename=element("button","Rename","ghost"),edit=element("form"),nameLabel=element("label","Calendar name"),nameInput=element("input"),saveName=element("button","Save name"),cancelName=element("button","Cancel","ghost"),nameStatus=element("p");
        edit.hidden=true;nameInput.value=calendar.name;nameInput.required=true;nameInput.maxLength=120;nameInput.id="rename-"+calendar.id;nameLabel.htmlFor=nameInput.id;rename.type=cancelName.type="button";saveName.type="submit";nameStatus.setAttribute("role","status");edit.append(nameLabel,nameInput,saveName,cancelName,nameStatus);
        var namePending=false,draft={dirty:function(){return nameInput.value!==calendar.name;},get pending(){return namePending;},reset:function(){nameInput.value=calendar.name;edit.hidden=true;nameStatus.textContent="";}};
        calendarDrafts[calendar.id]=draft;registerSettingsDraft("calendar-"+calendar.id,draft);
        rename.onclick=function(){edit.hidden=false;nameInput.focus();};cancelName.onclick=function(){draft.reset();rename.focus();};
        edit.onsubmit=async function(event){event.preventDefault();if(namePending)return;namePending=true;saveName.disabled=cancelName.disabled=nameInput.disabled=true;nameStatus.textContent="Saving...";
          try{await api("/api/calendars/"+calendar.id,"PUT",{expectedVersion:calendar.version,name:nameInput.value});namePending=false;draft.reset();await loadCalendarSettings();message("Calendar name saved.");}
          catch(error){nameStatus.textContent=error.message||"Name could not save. Your draft is retained.";
            if(String(error.message).includes("changed elsewhere")){
              var reviewName=element("button","Review current calendar","ghost");reviewName.type="button";reviewName.onclick=async function(){try{var latest=await api("/api/calendars"),current=latest.calendars.find(function(item){return item.id===calendar.id;});if(!current){nameStatus.textContent="This calendar was removed elsewhere. Your draft is retained; cancel to discard it.";return;}if(confirm("Current calendar name: "+current.name+". Keep your draft against this reviewed version?")){calendar.version=current.version;calendar.name=current.name;heading.textContent=current.name;nameStatus.textContent="Current version reviewed. Save your draft when ready.";}}catch(reviewError){nameStatus.textContent="Could not review current calendar: "+reviewError.message;}};nameStatus.appendChild(reviewName);
            }
          }
          finally{namePending=false;saveName.disabled=cancelName.disabled=nameInput.disabled=false;}
        };manageDetails.appendChild(edit);actions.appendChild(rename);
        var remove=element("button","Remove calendar","ghost");remove.type="button";remove.onclick=function(){
          if(!confirm("Remove "+calendar.name+"? Native events and subscription access in this app will be removed. Events in external calendars are not deleted."))return;
          busy(remove,async function(){await api("/api/calendars/"+calendar.id,"DELETE",{expectedVersion:calendar.version});settingsDrafts.delete("calendar-"+calendar.id);delete calendarDrafts[calendar.id];await loadCalendarSettings();});
        };actions.appendChild(remove);
      }
      manageDetails.appendChild(actions);section.appendChild(manageDetails);box.appendChild(section);
    });
  });
}
function loadGoogleCalendarSettings(data){
  if(data.canManage&&data.google&&data.google.connected&&googleDraft&&(googleDraft.dirty()||googleDraft.pending))return;
  settingsDrafts.delete("google-selection");googleDraft=null;
  var google=data.google||{},status=$("google-calendar-status"),actions=$("google-calendar-actions"),list=$("google-calendar-list");
  actions.replaceChildren();list.replaceChildren();
  if(!data.canManage){status.textContent="Sign in as a configured owner to connect or select Google calendars.";return;}
  if(!google.configured){status.textContent="Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in deployment settings to enable Google Calendar.";return;}
  if(!google.credentialsWritable){status.textContent="Set CONNECTIONS_MASTER_KEY before saving Google authorization tokens.";return;}
  if(!google.connected){
    status.textContent="Not connected. Sign in with Google to choose calendars.";
    var connect=appLink("Connect Google Calendar","/api/google-calendar/connect","btn");actions.appendChild(connect);return;
  }
  status.textContent="Connected. Selected calendars are synchronized when the calendar is opened or refreshed.";
  var disconnect=element("button","Disconnect Google Calendar","ghost");disconnect.type="button";
  disconnect.onclick=function(){if(!confirm("Disconnect Google Calendar and remove its saved authorization from this server?"))return;
    busy(disconnect,async function(){await api("/api/google-calendar","DELETE",{});if(googleDraft)googleDraft.reset();googleDraft=null;settingsDrafts.delete("google-selection");await loadCalendarSettings();message("Google Calendar disconnected.");});};
  actions.appendChild(disconnect);
  api("/api/google-calendar/calendars").then(function(result){
    var form=element("form"),title=element("h3","Choose calendars");
    form.appendChild(title);
    if(!result.calendars.length)form.appendChild(element("p","No Google calendars are available to this account.","dim"));
    result.calendars.forEach(function(calendar){
      var label=element("label",undefined,"row"),checkbox=element("input");checkbox.type="checkbox";checkbox.value=calendar.id;checkbox.checked=calendar.selected;
      label.append(checkbox,document.createTextNode(calendar.name+(calendar.writable?"":" · read only")));form.appendChild(label);
    });
    var save=element("button","Save calendar selection"),cancel=element("button","Cancel","ghost");save.type="submit";cancel.type="button";save.disabled=cancel.disabled=true;form.append(save,cancel);
    var initial=result.calendars.filter(function(calendar){return calendar.selected;}).map(function(calendar){return calendar.id;}).sort(),pending=false;
    function selection(){return Array.from(form.querySelectorAll('input[type="checkbox"]:checked')).map(function(input){return input.value;}).sort();}
    googleDraft={dirty:function(){return JSON.stringify(selection())!==JSON.stringify(initial);},get pending(){return pending;},reset:function(){form.querySelectorAll("input").forEach(function(input){input.checked=initial.includes(input.value);});save.disabled=cancel.disabled=true;}};
    registerSettingsDraft("google-selection",googleDraft);form.onchange=function(){save.disabled=cancel.disabled=!googleDraft.dirty();};cancel.onclick=function(){googleDraft.reset();};
    form.onsubmit=function(event){event.preventDefault();busy(save,async function(){
      if(pending)return;pending=true;cancel.disabled=true;form.querySelectorAll("input").forEach(function(input){input.disabled=true;});
      try{
      var ids=Array.from(form.querySelectorAll('input[type="checkbox"]:checked')).map(function(input){return input.value;});
      await api("/api/google-calendar/calendars","POST",{calendarIds:ids});initial=ids.sort();pending=false;await loadCalendarSettings();message("Google Calendar selection saved.");
      }finally{pending=false;cancel.disabled=!googleDraft.dirty();form.querySelectorAll("input").forEach(function(input){input.disabled=false;});}
    });};
    list.appendChild(form);
  }).catch(function(error){status.textContent="Connected, but calendar list could not load: "+(error.message||"refresh to retry.");});
}
$("calendar-kind").onchange=function(){$("calendar-url-field").hidden=this.value!=="ics";$("calendar-url").required=this.value==="ics";};
$("calendar-add").onsubmit=function(event){event.preventDefault();var button=this.querySelector("button");
  if(calendarAddPending)return;calendarAddPending=true;registerSettingsDraft("calendar-add",addDraft);
  var input={kind:$("calendar-kind").value,name:$("calendar-name").value,color:$("calendar-color").value,url:$("calendar-url").value};
  $("calendar-add").querySelectorAll("input,select,button").forEach(function(control){control.disabled=true;});
  busy(button,async function(){try{await api("/api/calendars","POST",input);addDraft.reset();await loadCalendarSettings();message("Calendar added.");}finally{calendarAddPending=false;$("calendar-add").querySelectorAll("input,select,button").forEach(function(control){control.disabled=false;});}});
};
var calendarAddPending=false,addDraft={dirty:function(){return !!($("calendar-name").value||$("calendar-url").value);},get pending(){return calendarAddPending;},reset:function(){$("calendar-add").reset();$("calendar-url-field").hidden=true;$("calendar-url").required=false;$("calendar-create-panel").open=false;}};
registerSettingsDraft("calendar-add",addDraft);$("calendar-add-cancel").onclick=function(){if(!calendarAddPending)addDraft.reset();};
var displaySaved=null,displayRevision=null,displayPending=false,displayCanManage=false;
function displayActions(){var dirty=displaySaved!==null&&$("calendar-week-start").value!==displaySaved;$("calendar-display-save").disabled=!dirty||displayPending||!displayCanManage;$("calendar-display-cancel").disabled=!dirty||displayPending;$("calendar-week-start").disabled=displaySaved===null||displayPending||!displayCanManage;}
registerSettingsDraft("calendar-display",{dirty:function(){return displaySaved!==null&&$("calendar-week-start").value!==displaySaved;},get pending(){return displayPending;},reset:function(){if(displaySaved!==null)$("calendar-week-start").value=displaySaved;displayActions();}});
async function loadDisplay(){$("calendar-display-retry").hidden=true;try{var result=await api("/api/settings");displaySaved=result.settings.viewPreferences.calendar.weekStartsOn;displayRevision=result.revision;displayCanManage=!(result.meta&&result.meta.canManage===false);$("calendar-week-start").value=displaySaved;$("calendar-display-status").textContent=displayCanManage?"":"View-only. Shared-settings permission is required.";displayActions();}catch(error){$("calendar-display-status").textContent=error.message||"Display settings could not load.";$("calendar-display-retry").hidden=false;}}
$("calendar-display-retry").onclick=loadDisplay;
$("calendar-week-start").onchange=displayActions;$("calendar-display-cancel").onclick=function(){$("calendar-week-start").value=displaySaved;displayActions();};
$("calendar-display").onsubmit=async function(event){event.preventDefault();if(displayPending||!displayCanManage)return;displayPending=true;displayActions();try{var result=await api("/api/settings","PUT",{viewPreferences:{calendar:{weekStartsOn:$("calendar-week-start").value}},expectedRevision:displayRevision});displaySaved=result.settings.viewPreferences.calendar.weekStartsOn;displayRevision=result.revision;$("calendar-display-status").textContent="Saved.";}catch(error){$("calendar-display-status").textContent=error.message||"Could not save. Your draft is retained.";if(String(error.message).includes("changed elsewhere")){var review=element("button","Review current preference","ghost");review.type="button";review.onclick=async function(){try{var current=await api("/api/settings");if(confirm("Current week start: "+current.settings.viewPreferences.calendar.weekStartsOn+". Keep your draft against this reviewed version?")){displaySaved=current.settings.viewPreferences.calendar.weekStartsOn;displayRevision=current.revision;displayActions();}}catch(e){fail(e);}};$("calendar-display-status").appendChild(review);}}finally{displayPending=false;displayActions();}};
function reloadCalendars(){loadCalendarSettings().catch(function(error){$("calendar-settings-status").textContent=error.message||"Calendar settings could not load.";$("calendar-settings-retry").hidden=false;});}
$("calendar-settings-retry").onclick=function(){reloadCalendars();if(displaySaved===null)loadDisplay();};loadDisplay();reloadCalendars();
`,
  });
}
