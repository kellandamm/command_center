import type { NavLink } from "./layout";
import { workspacePage } from "./workspace";

export function calendarSettingsPage(nav?: NavLink[]) {
  return workspacePage({
    title: "Calendars", active: "/settings", nav,
    description: "Bring your calendars together. Keep subscriptions read-only or create a calendar you can edit here.",
    body: `<p><a href="/settings">Back to Settings</a> &middot; <a href="/calendar">Open Calendar</a></p>
<p id="calendar-settings-status" role="status">Loading calendar settings...</p>
<section id="google-calendar-settings" class="workspace-details">
<h2>Google Calendar</h2>
<p id="google-calendar-status" role="status">Checking Google Calendar connection...</p>
<div id="google-calendar-actions" class="row"></div>
<div id="google-calendar-list"></div>
</section>
<form id="calendar-add" class="workspace-form" hidden>
<h2>Add a calendar</h2>
<label for="calendar-kind">Type</label><select id="calendar-kind"><option value="native">Command Center calendar</option><option value="ics">Existing calendar (ICS subscription)</option></select>
<label for="calendar-name">Name</label><input id="calendar-name" maxlength="120" required placeholder="Personal, work, focus...">
<label for="calendar-color">Color</label><input id="calendar-color" type="color" value="#2767ad">
<div id="calendar-url-field" hidden><label for="calendar-url">Private HTTPS subscription URL</label><input id="calendar-url" type="password" autocomplete="off" maxlength="4096">
<p class="dim">The URL may contain a private access token. It is encrypted and never returned to the browser. A subscription is read-only; it does not enable editing in the original calendar.</p></div>
<button type="submit" style="margin-top:1rem">Add calendar</button>
</form>
<div id="calendar-settings-list" class="workspace-details"></div>
<p class="dim">Sharing is off by default. A published link grants anyone holding it read access to all events, locations, and descriptions in that native calendar. External tools may refresh slowly. Revoke the link here to stop future access.</p>
<p class="dim">Behind Cloudflare Access, external subscriptions need a narrowly scoped edge policy for <code>/feeds/calendars/*.ics</code>. The app still checks each feed's revocable token; never bypass authentication for the whole site.</p>
<p id="calendar-feed-link" role="status" style="overflow-wrap:anywhere"></p>`,
    script: `
var calendarsState=null;
var googleResult=new URLSearchParams(location.search).get("google");
function loadCalendarSettings(){
  return api("/api/calendars").then(function(data){
    calendarsState=data;
    if(googleResult==="connected")message("Google Calendar connected. Select the calendars to show.");
    else if(googleResult==="failed")message("Google sign-in did not complete. Check the OAuth client and redirect URI, then try again.",true);
    googleResult=null;
    $("calendar-settings-status").textContent=(data.canManage?"Manage calendars below.":"Sign in through Cloudflare Access as a configured owner to change calendars.")+" Timezone: "+data.timezone+(data.environmentFeeds?" · "+data.environmentFeeds+" deployment-managed feed(s).":"");
    $("calendar-add").hidden=!data.canManage;
    $("calendar-kind").options[1].disabled=!data.credentialsWritable;
    loadGoogleCalendarSettings(data);
    var box=$("calendar-settings-list");box.replaceChildren();
    if(!data.calendars.length)box.append(element("p","No managed calendars yet. Create one above or connect an existing subscription.","dim"));
    data.calendars.forEach(function(calendar){
      var section=element("section",undefined,"workspace-details"),heading=element("h2",calendar.name);
      section.append(heading,element("p",(calendar.kind==="native"?"Editable native calendar":"Read-only subscription")+(calendar.enabled?"":" · Paused")+(calendar.sharing?" · Sharing enabled":""),"dim"));
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
            busy(revoke,async function(){await api("/api/calendars/"+calendar.id+"/sharing","DELETE",{expectedVersion:calendar.version});$("calendar-feed-link").textContent="Sharing link revoked.";await loadCalendarSettings();});
          };actions.appendChild(revoke);}
        }
      }
      if(data.canManage){
        var toggle=element("button",calendar.enabled?"Pause calendar":"Enable calendar","ghost");toggle.type="button";toggle.onclick=function(){
          busy(toggle,async function(){await api("/api/calendars/"+calendar.id,"PUT",{expectedVersion:calendar.version,enabled:!calendar.enabled});await loadCalendarSettings();});
        };actions.appendChild(toggle);
        var rename=element("button","Rename","ghost");rename.type="button";rename.onclick=function(){
          var name=prompt("Calendar name",calendar.name);if(!name||name===calendar.name)return;
          busy(rename,async function(){await api("/api/calendars/"+calendar.id,"PUT",{expectedVersion:calendar.version,name:name});await loadCalendarSettings();});
        };actions.appendChild(rename);
        var remove=element("button","Remove calendar","ghost");remove.type="button";remove.onclick=function(){
          if(!confirm("Remove "+calendar.name+"? Native events and subscription access in this app will be removed. Events in external calendars are not deleted."))return;
          busy(remove,async function(){await api("/api/calendars/"+calendar.id,"DELETE",{expectedVersion:calendar.version});await loadCalendarSettings();});
        };actions.appendChild(remove);
      }
      section.appendChild(actions);box.appendChild(section);
    });
  });
}
function loadGoogleCalendarSettings(data){
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
    busy(disconnect,async function(){await api("/api/google-calendar","DELETE",{});await loadCalendarSettings();message("Google Calendar disconnected.");});};
  actions.appendChild(disconnect);
  api("/api/google-calendar/calendars").then(function(result){
    var form=element("form"),title=element("h3","Choose calendars");
    form.appendChild(title);
    if(!result.calendars.length)form.appendChild(element("p","No Google calendars are available to this account.","dim"));
    result.calendars.forEach(function(calendar){
      var label=element("label",undefined,"row"),checkbox=element("input");checkbox.type="checkbox";checkbox.value=calendar.id;checkbox.checked=calendar.selected;
      label.append(checkbox,document.createTextNode(calendar.name+(calendar.writable?"":" · read only")));form.appendChild(label);
    });
    var save=element("button","Save calendar selection");save.type="submit";form.appendChild(save);
    form.onsubmit=function(event){event.preventDefault();busy(save,async function(){
      var ids=Array.from(form.querySelectorAll('input[type="checkbox"]:checked')).map(function(input){return input.value;});
      await api("/api/google-calendar/calendars","POST",{calendarIds:ids});await loadCalendarSettings();message("Google Calendar selection saved.");
    });};
    list.appendChild(form);
  }).catch(function(error){status.textContent="Connected, but calendar list could not load: "+(error.message||"refresh to retry.");});
}
$("calendar-kind").onchange=function(){$("calendar-url-field").hidden=this.value!=="ics";$("calendar-url").required=this.value==="ics";};
$("calendar-add").onsubmit=function(event){event.preventDefault();var button=this.querySelector("button");
  busy(button,async function(){await api("/api/calendars","POST",{kind:$("calendar-kind").value,name:$("calendar-name").value,color:$("calendar-color").value,url:$("calendar-url").value});$("calendar-name").value="";$("calendar-url").value="";await loadCalendarSettings();message("Calendar added.");});
};
loadCalendarSettings().catch(function(error){$("calendar-settings-status").textContent=error.message||"Calendar settings could not load. Reload to retry.";});
`,
  });
}
