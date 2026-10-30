/** Settings page markup (kept separate to keep pages.ts readable). */
import { pageHeader, settingsLinkRow } from "./components";

export function settingsPageBody(): string {
  return `<div class="phase2-page settings-page">
<div class="settings-stack">
${pageHeader({ title: "Settings", description: "Tune schedules, view behavior, and navigation." })}
<div class="settings-tabs" role="tablist" aria-label="Settings">
  <button type="button" role="tab" class="ghost on" id="settings-tab-general" data-section="general" aria-selected="true" aria-controls="settings-panel-general">General</button>
  <button type="button" role="tab" class="ghost" id="settings-tab-connections" data-section="connections" aria-selected="false" aria-controls="settings-panel-connections" tabindex="-1">Connections</button>
  <button type="button" role="tab" class="ghost" id="settings-tab-notifications" data-section="notifications" aria-selected="false" aria-controls="settings-panel-notifications" tabindex="-1">Notifications</button>
  <button type="button" role="tab" class="ghost" id="settings-tab-views" data-section="views" aria-selected="false" aria-controls="settings-panel-views" tabindex="-1">Views</button>
</div>
<div class="settings-tab-panels">
<div role="tabpanel" class="settings-section-panel on" id="settings-panel-general" aria-labelledby="settings-tab-general">
<section class="card settings-card" id="settings-features" aria-label="Deployment features">
<h2 style="margin:0 0 .5rem;font-size:1rem">Features</h2>
<p class="dim" style="margin:0 0 .75rem">Read-only deployment flags (no secret values).</p>
<div id="settings-features-list" class="settings-features-list"></div>
</section>
</div>
<div role="tabpanel" class="settings-section-panel" id="settings-panel-connections" aria-labelledby="settings-tab-connections" hidden>
<div class="settings-link-list">
${settingsLinkRow({ href: "/settings/connections", label: "Manage service connections and keys", iconName: "plug" })}
${settingsLinkRow({ href: "/settings/calendars", label: "Manage calendars and subscriptions", iconName: "calendar" })}
</div>
</div>
<div role="tabpanel" class="settings-section-panel" id="settings-panel-notifications" aria-labelledby="settings-tab-notifications" hidden>
<section class="card settings-card" id="settings-ntfy" aria-label="Phone notifications">
<h2 style="margin:0 0 .5rem;font-size:1rem">Phone notifications (ntfy)</h2>
<p id="ntfy-status" class="dim" role="status">Checking…</p>
<div class="row" style="margin-top:.75rem">
<button type="button" id="ntfy-test" disabled>Send test notification</button>
<span id="ntfy-test-status" class="dim" role="status"></span>
</div>
<p class="dim">Configure <code>NTFY_TOPIC</code> on the server (or save credentials under Service connections). Subscribe to the same topic in the ntfy app on your phone. The morning briefing digest is sent even during quiet hours; reminders and other alerts follow <code>NTFY_QUIET_HOURS</code> in the configured workspace <code>TZ</code>.</p>
<p id="ntfy-owner-hint" class="dim" role="status" hidden>Owner sign-in required to send a test notification.</p>
</section>
</div>
<div role="tabpanel" class="settings-section-panel" id="settings-panel-views" aria-labelledby="settings-tab-views" hidden>
<div class="settings-subtabs" role="tablist" aria-label="View and navigation preferences">
  <button type="button" role="tab" class="ghost on" id="settings-subtab-views" data-subtab="views" aria-selected="true" aria-controls="tab-views">Views</button>
  <button type="button" role="tab" class="ghost" id="settings-subtab-topics" data-subtab="topics" aria-selected="false" aria-controls="tab-topics" tabindex="-1">Briefing topics</button>
  <button type="button" role="tab" class="ghost" id="settings-subtab-schedule" data-subtab="schedule" aria-selected="false" aria-controls="tab-schedule" tabindex="-1">Schedule</button>
  <button type="button" role="tab" class="ghost" id="settings-subtab-tabs" data-subtab="tabs" aria-selected="false" aria-controls="tab-tabs" tabindex="-1">Tabs</button>
</div>
<div class="card settings-card settings-sub-panel on" id="tab-views" role="tabpanel" aria-labelledby="settings-subtab-views">
<p class="dim">Choose what each page shows and how it’s displayed. These preferences are saved on this server.</p>
<div class="settings-options-grid">
<div class="settings-option"><label for="pref-density">Page density</label><select id="pref-density" data-pref="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select><p class="dim">Compact reduces spacing across supported pages.</p></div>
<fieldset class="settings-option"><legend>Daily Briefing sections</legend>
<label class="row choice-row"><input type="checkbox" data-pref="briefing.topics"/> Keyword digest</label><label class="row choice-row"><input type="checkbox" data-pref="briefing.weather"/> Weather</label><label class="row choice-row"><input type="checkbox" data-pref="briefing.calendar"/> Calendar</label></fieldset>
<div class="settings-option"><label for="pref-hobie-status">Agent queue filter</label><select id="pref-hobie-status" data-pref="hobie.status"><option value="all">All tasks</option><option value="pending">Pending</option><option value="claimed">Claimed</option><option value="done">Done</option></select><p class="dim">Default filter on Agent → Queue.</p></div>
<div class="settings-option"><label for="pref-calendar-week">Calendar week starts on</label><select id="pref-calendar-week" data-pref="calendar.weekStartsOn"><option value="monday">Monday</option><option value="sunday">Sunday</option></select></div>
<div class="settings-option"><label for="pref-activity-limit">Activity entries</label><select id="pref-activity-limit" data-pref="activity.limit"><option value="25">25</option><option value="50">50</option><option value="100">100</option><option value="200">200</option></select></div>
<div class="settings-option"><label for="pref-notes-size">Notes text size</label><select id="pref-notes-size" data-pref="notes.fontSize"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></div>
</div>
<div class="row" style="margin-top:1rem"><button type="button" id="views-save">Save view preferences</button><span id="saved-views" class="dim"></span></div>
</div>
<div class="card settings-card settings-sub-panel" id="tab-topics" role="tabpanel" aria-labelledby="settings-subtab-topics" hidden>
<h2>Briefing topics</h2>
<p>Follow what matters to you. Your daily edition searches the web for each keyword or phrase and summarizes recent results with source links.</p>
<p class="dim">Searches cover the past 24 hours, not RSS feeds. AI digests use search excerpts, not full articles. These topics are shared across this server.</p>
<p id="settings-manage-hint" class="dim" role="status" hidden></p>
<p id="topics-providers" role="status">Checking search and summarizer configuration...</p>
<form id="f-topics">
<label for="briefingTopics">Keywords and phrases</label>
<textarea id="briefingTopics" rows="8" maxlength="1210" placeholder="Microsoft Fabric&#10;AI agent security&#10;Chicago technology" aria-describedby="topics-hint"></textarea>
<p id="topics-hint" class="dim">One topic per line. Up to 10 topics, 120 characters each. Remove a line to stop following it. Leave blank to turn off keyword searches.</p>
<div class="row"><button type="submit" id="topics-save" disabled>Save topics</button><span id="saved-topics" role="status"></span></div>
</form>
<p class="dim">Saved topics apply to the next scheduled edition. To use them now, open <a href="/briefing">Daily Briefing</a> and choose Refresh edition.</p>
</div>
<div class="card settings-card settings-sub-panel" id="tab-schedule" role="tabpanel" aria-labelledby="settings-subtab-schedule" hidden>
<form id="f-schedule">
<p class="dim">Prepare your keyword digest, calendar, and weather once a day at this time in the server's configured timezone.</p>
<label for="briefingTime">Daily briefing time</label><input id="briefingTime" type="time" required>
<div class="row" style="margin-top:18px"><button type="submit">Save schedule</button><span id="saved-schedule" class="dim"></span></div>
</form></div>
<div class="card settings-card settings-sub-panel" id="tab-tabs" role="tabpanel" aria-labelledby="settings-subtab-tabs" hidden>
<p class="dim">Show, hide, rename, and reorder sidebar tabs. Dashboard and Settings are always visible.</p>
<div id="tabs-editor"></div>
<div class="row" style="margin-top:1rem"><button type="button" id="tabs-save">Save tabs</button><span id="saved-tabs" class="dim"></span></div>
</div>
</div>
</div>
</div>
</div>`;
}

export const SETTINGS_PAGE_TAB_SCRIPT = `
var settingsState={sidebarTabs:[],viewPreferences:{}};
var SETTINGS_SECTIONS=["general","connections","notifications","views"];
var VIEW_SUBTABS=["views","topics","schedule","tabs"];
function syncMainTabs(section){
  document.querySelectorAll(".settings-tabs [data-section]").forEach(function(b){
    var on=b.dataset.section===section;
    b.classList.toggle("on",on);
    b.setAttribute("aria-selected",on?"true":"false");
    b.tabIndex=on?0:-1;
  });
  document.querySelectorAll(".settings-section-panel").forEach(function(p){
    var on=p.id==="settings-panel-"+section;
    p.classList.toggle("on",on);
    if(on)p.removeAttribute("hidden"); else p.setAttribute("hidden","");
  });
}
function syncViewSub(sub){
  document.querySelectorAll(".settings-subtabs [data-subtab]").forEach(function(b){
    var on=b.dataset.subtab===sub;
    b.classList.toggle("on",on);
    b.setAttribute("aria-selected",on?"true":"false");
    b.tabIndex=on?0:-1;
  });
  document.querySelectorAll("#settings-panel-views .settings-sub-panel").forEach(function(p){
    var on=p.id==="tab-"+sub;
    p.classList.toggle("on",on);
    if(on)p.removeAttribute("hidden"); else p.setAttribute("hidden","");
  });
}
function setSettingsSection(section,viewSub){
  syncMainTabs(section);
  if(section==="views")syncViewSub(viewSub||"views");
}
document.querySelectorAll(".settings-tabs [data-section]").forEach(function(b){
  b.onclick=function(){setSettingsSection(b.dataset.section,b.dataset.section==="views"?"views":undefined);};
});
document.querySelectorAll(".settings-subtabs [data-subtab]").forEach(function(b){
  b.onclick=function(){setSettingsSection("views",b.dataset.subtab);};
});
function showHashTab(){
  var name=location.hash.slice(1);
  if(!name)return;
  if(SETTINGS_SECTIONS.indexOf(name)>=0&&name!=="views"){setSettingsSection(name);return;}
  if(VIEW_SUBTABS.indexOf(name)>=0){setSettingsSection("views",name);return;}
}
window.addEventListener("hashchange",showHashTab);showHashTab();
`;
