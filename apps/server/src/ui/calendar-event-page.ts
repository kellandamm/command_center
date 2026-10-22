import type { NavLink } from "./layout";
import { workspacePage } from "./workspace";

export function calendarEventPage(nav?: NavLink[]) {
  return workspacePage({
    title: "Calendar event", active: "/calendar", nav,
    description: "Reserve time on a Command Center calendar. Subscribed calendars remain read-only.",
    body: `<p><a href="/calendar">Back to Calendar</a> &middot; <a href="/settings/calendars">Calendar settings</a></p>
<section id="task-planning" class="workspace-details" hidden aria-labelledby="task-heading">
<h2 id="task-heading">Board task</h2><p id="task-identity" style="overflow-wrap:anywhere"></p>
<form id="task-form" class="workspace-form"><fieldset id="task-fields" style="border:0;padding:0">
<label for="task-title">Task title</label><input id="task-title" required maxlength="200">
<label for="task-estimate">Estimated minutes (optional, 1-1440)</label><input id="task-estimate" type="number" min="1" max="1440" step="1">
<label for="task-due">Deadline (date only, not a time reservation)</label><input id="task-due" type="date">
<label for="task-priority">Priority</label><select id="task-priority"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select>
<div class="row"><button type="submit">Save task details</button><button id="task-complete" type="button" class="ghost">Complete task</button></div>
</fieldset></form><p id="task-status" role="status"></p><div id="task-blocks"></div>
<p class="dim">Saving a new event creates a separate block, even for the same task and time. Edit an existing block below to reschedule it. Multiple blocks are allowed; completing a task preserves its blocks and adds the usual Board win. Scheduling does not queue agent work or change existing meetings.</p>
</section>
<p id="event-load-status" role="status">Loading calendars...</p>
<form id="event-form" class="workspace-form" hidden>
<fieldset id="event-fields" style="border:0;padding:0">
<label for="event-title">Title</label><input id="event-title" maxlength="240" required>
<label for="event-calendar">Calendar</label><select id="event-calendar" required></select>
<label for="event-task">Linked Board task (native calendars only)</label><select id="event-task"><option value="">No task</option></select>
<p class="dim" id="event-task-hint">A task link does not complete the task. Clear a missing link before saving an orphaned block.</p>
<label class="row"><input id="event-all-day" type="checkbox"> All-day event</label>
<div class="row"><div><label for="event-start">Starts</label><input id="event-start" type="datetime-local" required></div><div><label for="event-end">Ends (exclusive for all-day)</label><input id="event-end" type="datetime-local" required></div></div>
<label for="event-timezone">Timezone</label><input id="event-timezone" maxlength="100" required placeholder="America/Chicago">
<p class="dim">Times use this timezone, not your browser's zone. During a repeated fall-back hour, the earlier occurrence is selected.</p>
<div id="event-duration-fields"><label class="row"><input id="event-use-duration" type="checkbox"> Set end using elapsed duration</label><label for="event-duration">Duration in minutes</label><input id="event-duration" type="number" min="1" max="1440" step="1" value="30"><p class="dim">Duration is actual elapsed time, including across clock changes. It does not change the task estimate.</p></div>
<label for="event-repeat">Repeat</label><select id="event-repeat"><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly (same day of month)</option></select>
<div id="event-repeat-end" hidden><label for="event-until">Repeat through</label><input id="event-until" type="date"><p class="dim">Within one year of the first event. Monthly events skip months without that date. Editing applies to the whole series.</p></div>
<p id="event-provider-note" class="dim" hidden>Google Calendar events do not support local note links or recurrence in this editor. Changes are saved directly to Google and are rejected if the event changed elsewhere.</p>
<label for="event-location">Location</label><input id="event-location" maxlength="2000">
<label for="event-description">Description</label><textarea id="event-description" rows="6" maxlength="20000"></textarea>
<label for="event-space">Space (optional)</label><select id="event-space"><option value="">No space</option></select>
<label for="event-note">Linked note (optional)</label><select id="event-note"><option value="">No linked note</option></select>
<details id="event-preview-options"><summary>Availability preview (no changes)</summary>
<p class="dim">Checks the first occurrence against enabled calendars, including subscriptions and selected Google calendars. Warnings do not prevent saving. Working hours and buffers apply only to this preview, not stored preferences.</p>
<label for="event-work-start">Working day starts (Monday-Friday)</label><input id="event-work-start" type="time" value="09:00" required>
<label for="event-work-end">Working day ends</label><input id="event-work-end" type="time" value="17:00" required>
<label for="event-buffer">Buffer minutes (0-120)</label><input id="event-buffer" type="number" min="0" max="120" step="1" value="0" required>
<button type="button" class="ghost" id="event-preview">Preview availability</button><p id="event-preview-status" role="status" style="white-space:pre-wrap;overflow-wrap:anywhere"></p>
</details>
<div class="row" style="margin-top:1rem"><button type="submit" id="event-save">Save event</button><button type="button" class="ghost" id="event-delete" hidden>Delete event</button></div>
</fieldset></form>
<p id="event-save-status" role="status" style="overflow-wrap:anywhere"></p>`,
    script: `
var savedEvent=null,eventId=new URLSearchParams(location.search).get("event"),taskId=new URLSearchParams(location.search).get("task"),planning={cards:[],blocks:[]},selectedTask=null;
function renderTask(){
  selectedTask=planning.cards.find(function(card){return card.id===$("event-task").value;})||null;
  $("task-planning").hidden=!selectedTask;
  if(!selectedTask)return;
  $("task-identity").textContent=selectedTask.title+" · "+selectedTask.column+" · Board ID "+selectedTask.id;
  Array.from($("event-task").options).forEach(function(option){if(option.value===selectedTask.id)option.textContent=selectedTask.title+" · "+selectedTask.column;});
  $("task-title").value=selectedTask.title;$("task-estimate").value=selectedTask.estimatedMinutes||"";$("task-due").value=selectedTask.dueDate||"";$("task-priority").value=selectedTask.priority;
  $("task-complete").disabled=selectedTask.column==="Done";
  var blocks=planning.blocks.filter(function(block){return block.taskId===selectedTask.id;});$("task-blocks").replaceChildren();
  blocks.forEach(function(block){var a=appLink("Edit / reschedule: "+block.summary+" · "+(block.allDay?block.start:eventDay(block.start,block.timezone))+" · "+block.timezone+(block.enabled?"":" · paused calendar"),"/calendar/event?event="+encodeURIComponent(block.id));a.style.display="block";$("task-blocks").appendChild(a);});
  if(!blocks.length)$("task-blocks").textContent="No native blocks yet. Reserve time below.";
}
function saveTask(complete){
  if(!selectedTask)return;
  var body=complete?{column:"Done"}:{title:$("task-title").value,estimatedMinutes:$("task-estimate").value?Number($("task-estimate").value):null,dueDate:$("task-due").value||null,priority:$("task-priority").value};
  body.id=selectedTask.id;body.expectedVersion=selectedTask.version;$("task-fields").disabled=true;
  api("/api/board/cards","PATCH",body).then(function(result){
    planning.cards=planning.cards.map(function(card){return card.id===result.card.id?result.card:card;});renderTask();$("task-status").textContent=complete?"Task completed. Reserved time is unchanged.":"Task details saved. Reserved time is unchanged.";
  }).catch(function(error){$("task-status").textContent="Not saved: "+error.message;}).finally(function(){$("task-fields").disabled=false;$("task-complete").disabled=selectedTask.column==="Done";});
}
$("task-form").onsubmit=function(event){event.preventDefault();saveTask(false);};
$("task-complete").onclick=function(){saveTask(true);};
$("event-task").onchange=function(){renderTask();calendarProviderChanged();};
function eventDay(value,timezone){var parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value)).map(function(part){return [part.type,part.value];}));return parts.year+"-"+parts.month+"-"+parts.day+"T"+parts.hour+":"+parts.minute;}
function eventAllDay(){var all=$("event-all-day").checked;["event-start","event-end"].forEach(function(id){var input=$(id),value=input.value;input.type=all?"date":"datetime-local";input.value=all?value.slice(0,10):value.length===10?value+"T09:00":value;});durationChanged();}
function durationChanged(){var disabled=$("event-all-day").checked||$("event-calendar").value.indexOf("google-")===0;$("event-duration-fields").hidden=disabled;$("event-duration").disabled=disabled||!$("event-use-duration").checked;$("event-end").disabled=!disabled&&$("event-use-duration").checked;}
$("event-use-duration").onchange=durationChanged;
$("event-all-day").onchange=eventAllDay;
$("event-repeat").onchange=function(){$("event-repeat-end").hidden=this.value==="none";$("event-until").required=this.value!=="none";};
function calendarProviderChanged(){
  var remote=$("event-calendar").value.indexOf("google-")===0;
  $("event-repeat").disabled=remote;$("event-space").disabled=remote;$("event-note").disabled=remote;
  $("event-task").disabled=remote;$("event-preview-options").hidden=remote;
  $("event-provider-note").hidden=!remote;
  if(remote){$("event-repeat").value="none";$("event-repeat").onchange();$("event-space").value="";$("event-note").value="";$("event-task").value="";renderTask();}
  durationChanged();
}
Promise.all([api("/api/calendars"),api("/api/google-calendar/calendars"),api("/api/knowledge"),eventId?api("/api/calendar-events/"+encodeURIComponent(eventId)):Promise.resolve({event:null}),api("/api/calendars/planning")]).then(function(results){
  var data=results[0],google=results[1],knowledge=results[2];savedEvent=results[3].event;
  planning={cards:results[4].cards||[],blocks:results[4].blocks||[]};
  planning.cards.forEach(function(card){$("event-task").add(new Option(card.title+" · "+card.column,card.id));});
  var linkedTask=savedEvent?savedEvent.taskId:taskId;
  if(linkedTask&&!planning.cards.some(function(card){return card.id===linkedTask;}))$("event-task").add(new Option("Missing task · clear this link before saving",linkedTask));
  $("event-task").value=linkedTask||"";renderTask();
  var native=data.calendars.filter(function(calendar){return calendar.kind==="native";});
  var writableGoogle=(google.calendars||[]).filter(function(calendar){return calendar.selected&&calendar.writable;});
  if(!data.canManage){$("event-load-status").textContent="Sign in through Cloudflare Access as a configured owner to edit calendars.";return;}
  if(!native.length&&!writableGoogle.length){$("event-load-status").textContent="Create a Command Center calendar or select a writable Google calendar in Calendar settings before adding events.";return;}
  native.forEach(function(calendar){$("event-calendar").add(new Option(calendar.name+(calendar.enabled?"":" (paused)"),calendar.id));});
  if(!taskId||savedEvent)writableGoogle.forEach(function(calendar){$("event-calendar").add(new Option(calendar.name+" · Google Calendar",calendar.id));});
  if(taskId&&!savedEvent&&!native.length){$("event-load-status").textContent="Create a native Command Center calendar in Calendar settings before scheduling a task. Tasks never write to Google calendars.";return;}
  $("event-calendar").onchange=calendarProviderChanged;
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
    if(savedEvent.syncVersion)$("event-calendar").value=savedEvent.calendarId;
  }else{
    var start=new Date(),end=new Date(start.getTime()+3600000);
    $("event-start").value=eventDay(start,data.timezone);$("event-end").value=eventDay(end,data.timezone);
    if(selectedTask){$("event-title").value=selectedTask.title;$("event-duration").value=selectedTask.estimatedMinutes||30;$("event-use-duration").checked=true;}
  }
  calendarProviderChanged();
  $("event-load-status").textContent=savedEvent&&savedEvent.recurrence!=="none"?"Editing the entire recurring series.":"";
  $("event-form").hidden=false;
}).catch(function(error){$("event-load-status").textContent=error.message||"Could not load event. Reload to retry.";});
function eventBody(){
  var all=$("event-all-day").checked,body={
    summary:$("event-title").value,calendarId:$("event-calendar").value,allDay:all,timezone:$("event-timezone").value,
    recurrence:$("event-repeat").disabled?"none":$("event-repeat").value,repeatUntil:$("event-until").value||null,
    description:$("event-description").value,location:$("event-location").value
  };
  if(!$("event-space").disabled){body.spaceId=$("event-space").value||null;body.noteId=$("event-note").value||null;body.taskId=$("event-task").value||null;if(selectedTask)body.expectedTaskVersion=selectedTask.version;}
  if(all){body.start=$("event-start").value;body.end=$("event-end").value;}else{body.localStart=$("event-start").value;body.localEnd=$("event-end").value;}
  if(!$("event-duration-fields").hidden&&$("event-use-duration").checked)body.durationMinutes=Number($("event-duration").value);
  if(savedEvent){body.expectedVersion=savedEvent.version;if(savedEvent.syncVersion)body.expectedSyncVersion=savedEvent.syncVersion;}
  return body;
}
$("event-form").oninput=function(){if($("event-preview-status").textContent)$("event-preview-status").textContent="Event changed. Preview availability again before relying on warnings.";};
$("event-preview").onclick=function(){
  if(!$("event-form").reportValidity())return;
  var body=eventBody();if(eventId)body.id=eventId;body.workStart=$("event-work-start").value;body.workEnd=$("event-work-end").value;body.bufferMinutes=Number($("event-buffer").value);
  $("event-fields").disabled=true;$("event-preview-status").textContent="Checking availability...";
  api("/api/calendar-events/preview","POST",body).then(function(result){
    $("event-preview-status").textContent=(result.warnings.length?result.warnings.join("\\n"):"No overlaps or working-hour warnings found in available calendars.")+"\\nPreview only. Save event explicitly to reserve this time.";
  }).catch(function(error){$("event-preview-status").textContent="Preview unavailable: "+error.message;}).finally(function(){$("event-fields").disabled=false;durationChanged();});
};
$("event-form").onsubmit=function(event){
  event.preventDefault();var body=eventBody();
  $("event-fields").disabled=true;$("event-save-status").textContent="Saving...";
  api("/api/calendar-events"+(eventId?"/"+encodeURIComponent(eventId):""),eventId?"PUT":"POST",body).then(function(result){
    savedEvent=result.event;eventId=savedEvent.id;history.replaceState(null,"","/calendar/event?event="+encodeURIComponent(eventId));
    $("event-delete").hidden=false;$("event-save-status").textContent="Event saved. Return to Calendar to see it.";
    if(!savedEvent.allDay)$("event-end").value=eventDay(savedEvent.end,savedEvent.timezone);
    if(!savedEvent.syncVersion){var old=planning.blocks.findIndex(function(block){return block.id===savedEvent.id;}),block=Object.assign({},savedEvent,{enabled:true});if(old<0)planning.blocks.push(block);else planning.blocks[old]=block;renderTask();}
  }).catch(function(error){$("event-save-status").textContent="Not saved: "+error.message;}).finally(function(){$("event-fields").disabled=false;durationChanged();});
};
$("event-delete").onclick=function(){
  if(!savedEvent||!confirm("Delete this event"+(savedEvent.recurrence!=="none"?" and every occurrence in its series":"")+"?"))return;
  $("event-fields").disabled=true;api("/api/calendar-events/"+encodeURIComponent(savedEvent.id),"DELETE",{expectedVersion:savedEvent.version,expectedSyncVersion:savedEvent.syncVersion}).then(function(){location.href="/calendar";}).catch(function(error){$("event-save-status").textContent=error.message;$("event-fields").disabled=false;});
};
`,
  });
}
