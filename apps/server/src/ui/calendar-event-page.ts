import type { NavLink } from "./layout";
import { workspacePage } from "./workspace";

export function calendarEventPage(nav?: NavLink[]) {
  return workspacePage({
    title: "Calendar event", active: "/calendar", nav,
    description: "Reserve time on a Command Center calendar. Subscribed calendars remain read-only.",
    body: `<p><a href="/calendar">Back to Calendar</a> &middot; <a href="/settings/calendars">Calendar settings</a></p>
<p id="event-load-status" role="status">Loading calendars...</p>
<form id="event-form" class="workspace-form" hidden>
<fieldset id="event-fields" style="border:0;padding:0">
<label for="event-title">Title</label><input id="event-title" maxlength="240" required>
<label for="event-calendar">Calendar</label><select id="event-calendar" required></select>
<label class="row"><input id="event-all-day" type="checkbox"> All-day event</label>
<div class="row"><div><label for="event-start">Starts</label><input id="event-start" type="datetime-local" required></div><div><label for="event-end">Ends (exclusive for all-day)</label><input id="event-end" type="datetime-local" required></div></div>
<label for="event-timezone">Timezone</label><input id="event-timezone" maxlength="100" required placeholder="America/Chicago">
<p class="dim">Times use this timezone, not your browser's zone. During a repeated fall-back hour, the earlier occurrence is selected.</p>
<label for="event-repeat">Repeat</label><select id="event-repeat"><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly (same day of month)</option></select>
<div id="event-repeat-end" hidden><label for="event-until">Repeat through</label><input id="event-until" type="date"><p class="dim">Within one year of the first event. Monthly events skip months without that date. Editing applies to the whole series.</p></div>
<label for="event-location">Location</label><input id="event-location" maxlength="2000">
<label for="event-description">Description</label><textarea id="event-description" rows="6" maxlength="20000"></textarea>
<label for="event-space">Space (optional)</label><select id="event-space"><option value="">No space</option></select>
<label for="event-note">Linked note (optional)</label><select id="event-note"><option value="">No linked note</option></select>
<div class="row" style="margin-top:1rem"><button type="submit" id="event-save">Save event</button><button type="button" class="ghost" id="event-delete" hidden>Delete event</button></div>
</fieldset></form>
<p id="event-save-status" role="status" style="overflow-wrap:anywhere"></p>`,
    script: `
var savedEvent=null,eventId=new URLSearchParams(location.search).get("event");
function eventDay(value,timezone){var parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value)).map(function(part){return [part.type,part.value];}));return parts.year+"-"+parts.month+"-"+parts.day+"T"+parts.hour+":"+parts.minute;}
function eventAllDay(){var all=$("event-all-day").checked;["event-start","event-end"].forEach(function(id){var input=$(id),value=input.value;input.type=all?"date":"datetime-local";input.value=all?value.slice(0,10):value.length===10?value+"T09:00":value;});}
$("event-all-day").onchange=eventAllDay;
$("event-repeat").onchange=function(){$("event-repeat-end").hidden=this.value==="none";$("event-until").required=this.value!=="none";};
Promise.all([api("/api/calendars"),api("/api/knowledge"),eventId?api("/api/calendar-events/"+encodeURIComponent(eventId)):Promise.resolve({event:null})]).then(function(results){
  var data=results[0],knowledge=results[1];savedEvent=results[2].event;
  var native=data.calendars.filter(function(calendar){return calendar.kind==="native";});
  if(!data.canManage){$("event-load-status").textContent="Sign in through Cloudflare Access as a configured owner to edit calendars.";return;}
  if(!native.length){$("event-load-status").textContent="Create a Command Center calendar in Calendar settings before adding events.";return;}
  native.forEach(function(calendar){$("event-calendar").add(new Option(calendar.name+(calendar.enabled?"":" (paused)"),calendar.id));});
  (knowledge.spaces||[]).forEach(function(space){$("event-space").add(new Option(space.name,space.id));});
  (knowledge.notes||[]).forEach(function(note){$("event-note").add(new Option(note.title,note.id));});
  $("event-timezone").value=savedEvent?savedEvent.timezone:data.timezone;
  if(savedEvent){
    $("event-title").value=savedEvent.summary;$("event-calendar").value=savedEvent.calendarId;
    $("event-all-day").checked=savedEvent.allDay;eventAllDay();
    $("event-start").value=savedEvent.allDay?savedEvent.start:eventDay(savedEvent.start,savedEvent.timezone);
    $("event-end").value=savedEvent.allDay?savedEvent.end:eventDay(savedEvent.end,savedEvent.timezone);
    $("event-repeat").value=savedEvent.recurrence;$("event-repeat").onchange();$("event-until").value=savedEvent.repeatUntil||"";
    $("event-location").value=savedEvent.location;$("event-description").value=savedEvent.description;
    $("event-space").value=savedEvent.spaceId||"";$("event-note").value=savedEvent.noteId||"";$("event-delete").hidden=false;
  }else{
    var start=new Date(),end=new Date(start.getTime()+3600000);
    $("event-start").value=eventDay(start,data.timezone);$("event-end").value=eventDay(end,data.timezone);
  }
  $("event-load-status").textContent=savedEvent&&savedEvent.recurrence!=="none"?"Editing the entire recurring series.":"";
  $("event-form").hidden=false;
}).catch(function(error){$("event-load-status").textContent=error.message||"Could not load event. Reload to retry.";});
$("event-form").onsubmit=function(event){
  event.preventDefault();var all=$("event-all-day").checked,body={
    summary:$("event-title").value,calendarId:$("event-calendar").value,allDay:all,timezone:$("event-timezone").value,
    recurrence:$("event-repeat").value,repeatUntil:$("event-until").value||null,
    description:$("event-description").value,location:$("event-location").value,
    spaceId:$("event-space").value||null,noteId:$("event-note").value||null,taskId:savedEvent?savedEvent.taskId:null
  };
  if(all){body.start=$("event-start").value;body.end=$("event-end").value;}else{body.localStart=$("event-start").value;body.localEnd=$("event-end").value;}
  if(savedEvent)body.expectedVersion=savedEvent.version;
  $("event-fields").disabled=true;$("event-save-status").textContent="Saving...";
  api("/api/calendar-events"+(eventId?"/"+encodeURIComponent(eventId):""),eventId?"PUT":"POST",body).then(function(result){
    savedEvent=result.event;eventId=savedEvent.id;history.replaceState(null,"","/calendar/event?event="+encodeURIComponent(eventId));
    $("event-delete").hidden=false;$("event-save-status").textContent="Event saved. Return to Calendar to see it.";
  }).catch(function(error){$("event-save-status").textContent="Not saved: "+error.message;}).finally(function(){$("event-fields").disabled=false;});
};
$("event-delete").onclick=function(){
  if(!savedEvent||!confirm("Delete this event"+(savedEvent.recurrence!=="none"?" and every occurrence in its series":"")+"?"))return;
  $("event-fields").disabled=true;api("/api/calendar-events/"+encodeURIComponent(savedEvent.id),"DELETE",{expectedVersion:savedEvent.version}).then(function(){location.href="/calendar";}).catch(function(error){$("event-save-status").textContent=error.message;$("event-fields").disabled=false;});
};
`,
  });
}
