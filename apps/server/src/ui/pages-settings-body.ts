function actions(id: string, label = "Save changes"): string {
  return `<div class="settings-actions" id="actions-${id}" hidden><button type="submit" id="${id}-save">${label}</button><button type="button" class="ghost" data-cancel="${id}">Cancel</button><span id="saved-${id}" role="status" aria-live="polite"></span></div>`;
}

function select(id: string, label: string, pref: string, options: [string, string][], help = ""): string {
  return `<div class="settings-row"><div><label for="${id}">${label}</label>${help ? `<p class="dim">${help}</p>` : ""}</div><select id="${id}" data-pref="${pref}">${options.map(([value, name]) => `<option value="${value}">${name}</option>`).join("")}</select></div>`;
}

export function settingsPageBody(): string {
  return `<p id="settings-load-status" role="status">Loading current settings...</p>
<button type="button" id="settings-retry" class="ghost" hidden>Retry loading settings</button>
<p id="settings-manage-hint" class="dim" role="status" hidden></p>
<div data-settings-panel="general" id="settings-panel-general">
<section class="settings-group"><h3>Your workspace</h3><p>Preferences here are shared by everyone using this server, not just this browser. Changes take effect after you save.</p><div id="settings-general-summary"></div></section>
<section class="settings-group"><h3>Connected features</h3><p id="settings-setup-status" role="status"></p><p><a href="/settings/connections">Review service connections</a> to see which features each service powers and check its access.</p></section>
</div>
<fieldset id="settings-editor" disabled style="border:0;padding:0;margin:0;min-width:0">
<div data-settings-panel="appearance" id="settings-panel-appearance" hidden>
<form id="f-views" class="settings-group"><h3>Display defaults</h3><p class="dim settings-scope">Shared preferences</p>
${select("pref-density", "Page density", "density", [["comfortable", "Comfortable"], ["compact", "Compact"]], "Spacing across supported pages.")}
${select("pref-notes-size", "Notes text size", "notes.fontSize", [["small", "Small"], ["medium", "Medium"], ["large", "Large"]])}
${select("pref-hobie-status", "Agent queue filter", "hobie.status", [["all", "All tasks"], ["pending", "Pending"], ["claimed", "Claimed"], ["done", "Done"]])}
${select("pref-activity-limit", "Activity entries", "activity.limit", [["25", "25"], ["50", "50"], ["100", "100"], ["200", "200"]])}
${actions("views")}</form>
<form id="f-tabs" class="settings-group"><h3>Sidebar navigation</h3><p class="dim">Show, hide, rename, and reorder pages. Dashboard and Settings always stay visible.</p><div id="tabs-editor"></div>${actions("tabs")}</form>
</div>
<div data-settings-panel="briefing" id="settings-panel-briefing" hidden>
<form id="f-schedule" class="settings-group"><h3>Daily schedule</h3><p class="dim">Prepare your keyword digest, calendar, and weather once a day.</p><div class="settings-row"><div><label for="briefingTime">Briefing time</label><p id="schedule-timezone" class="dim"></p></div><input id="briefingTime" type="time" required></div>${actions("schedule")}</form>
<form id="f-topics" class="settings-group"><h3>Followed topics</h3><p>Search the past 24 hours for keywords and phrases. AI digests summarize search excerpts with source links, not full articles.</p><p id="topics-providers" class="dim" role="status"></p><label for="briefingTopics">Keywords and phrases</label><textarea id="briefingTopics" rows="6" maxlength="1210" placeholder="Microsoft Fabric&#10;AI agent security" aria-describedby="topics-hint"></textarea><p id="topics-hint" class="dim">One topic per line. Up to 10 topics, 120 characters each. Leave blank to turn off keyword searches.</p>${actions("topics", "Save topics")}<p class="dim">Applies to the next edition. Use Refresh edition in <a href="/briefing">Daily Briefing</a> to apply saved changes now.</p></form>
<form id="f-briefing" class="settings-group"><h3>Visible sections</h3><p class="dim">Choose what appears in Daily Briefing.</p><label class="row"><input type="checkbox" data-pref="briefing.topics">Keyword digest</label><label class="row"><input type="checkbox" data-pref="briefing.weather">Weather</label><label class="row"><input type="checkbox" data-pref="briefing.calendar">Calendar</label>${actions("briefing")}</form>
</div>
<div data-settings-panel="calendars" id="settings-panel-calendars" hidden>
<form id="f-calendar" class="settings-group"><h3>Calendar display</h3>${select("pref-calendar-week", "Week starts on", "calendar.weekStartsOn", [["monday", "Monday"], ["sunday", "Sunday"]])}${actions("calendar")}</form><p><a href="/settings/calendars">Manage calendars, Google connection, subscriptions, and sharing</a></p>
</div>
</fieldset>
<div data-settings-panel="notifications" id="settings-panel-notifications" hidden><section class="settings-group" id="settings-ntfy"><h3>Phone notifications</h3><p id="ntfy-status" class="dim" role="status">Loading notification settings...</p><div id="ntfy-details"></div><div class="settings-actions"><button type="button" id="ntfy-test" disabled>Send test notification</button><span id="ntfy-test-status" role="status"></span></div><p id="ntfy-owner-hint" class="dim" hidden>A verified owner login is required to send a test notification.</p><p><a href="/settings/connections#ntfy">Manage ntfy connection</a></p><details><summary>Delivery and quiet hours</summary><p class="dim">The morning briefing digest is sent even during quiet hours. Reminders and other alerts follow deployment quiet hours in the server timezone. Deployment ntfy values take precedence over saved connection values.</p></details></section></div>
<div data-settings-panel="advanced" id="settings-panel-advanced" hidden><section class="settings-group"><h3>Server configuration</h3><p class="dim">Deployment-managed, read-only values. Change the server environment and restart to update them. No secret values are shown.</p><div id="settings-overview"></div><details><summary>Deployment setup reference</summary><p class="dim">Set <code>TZ</code> for the server timezone. Weather uses <code>WEATHER_LAT</code> and <code>WEATHER_LON</code>. Provider credentials belong in Connections or deployment configuration.</p><p class="dim"><code>OWNER_EMAILS</code> restricts shared-setting edits. Provider and calendar management still require a verified owner login through Cloudflare Access. <code>CONNECTIONS_MASTER_KEY</code> enables encrypted storage; keep the key backed up separately from the data volume.</p></details></section><section class="settings-group" id="settings-features"><h3>Deployment features</h3><div id="settings-features-list"></div><details><summary>Change deployment features</summary><p class="dim">Use <code>WHITEBOARD_ENABLED</code> and <code>SHARE_LINKS_ENABLED</code>, then restart the server. Public share links also require a narrowly scoped Cloudflare Access policy. See the self-hosting documentation before enabling them.</p></details></section></div>
<div id="settings-conflict" role="alert" hidden><h3>Settings changed elsewhere</h3><p>Your draft is retained. Review the current server values below, then choose which version to keep. Saving is paused until you decide.</p><pre id="settings-conflict-current" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre><div class="settings-actions"><button id="settings-conflict-reload" type="button">Discard draft and load current</button><button id="settings-conflict-keep" type="button" class="ghost">Keep draft against reviewed version</button></div></div>`;
}

export const SETTINGS_PAGE_TAB_SCRIPT = `
var settingsState={sidebarTabs:[],viewPreferences:{}},activeSettingsCategory="general";
var categoryInfo={
 general:["General","Workspace scope, timezone, and setup."],
 appearance:["Appearance & navigation","Display defaults and the pages in your sidebar."],
 briefing:["Daily briefing","Your schedule, followed topics, and edition contents."],
 calendars:["Calendar display","Shared display defaults for the calendar."],
 notifications:["Notifications","Current phone notification setup and delivery behavior."],
 advanced:["Advanced","Read-only deployment configuration and access."]
};
function showSettingsCategory(){
 var name=location.hash.slice(1),aliases={overview:"general",views:"appearance",tabs:"appearance",topics:"briefing",schedule:"briefing"};
 if(name==="connections"||name==="capture"){confirmSettingsLeave().then(function(leave){if(leave)location.replace("/settings/"+name);});return;}
 var category=aliases[name]||name;if(!categoryInfo[category])category="general";
 activeSettingsCategory=category;
 document.querySelectorAll("[data-settings-panel]").forEach(function(panel){panel.hidden=panel.dataset.settingsPanel!==category;});
 $("settings-category-title").textContent=categoryInfo[category][0];$("settings-category-description").textContent=categoryInfo[category][1];
 document.querySelectorAll("[data-settings-category]").forEach(function(a){if(a.dataset.settingsCategory===category)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");});
 var href=category==="calendars"?"/settings/calendars":"/settings#"+category;
 $("settings-category").value=href;$("settings-category").dataset.current=href;
 if(["topics","schedule","tabs"].includes(name))requestAnimationFrame(function(){var form=$("f-"+name);if(form)form.scrollIntoView({block:"start"});});
}
window.addEventListener("hashchange",showSettingsCategory);showSettingsCategory();
`;
