import type { NavLink } from "./layout";
import { workspacePage } from "./workspace";

const categories = [
  ["general", "General", "/settings#general", "Workspace timezone shared preferences"],
  ["appearance", "Appearance & navigation", "/settings#appearance", "Density notes text size sidebar tabs activity agent queue"],
  ["briefing", "Daily briefing", "/settings#briefing", "Schedule topics weather calendar keyword digest"],
  ["connections", "Connections", "/settings/connections", "AI model Brave GitHub Todoist Recallio ntfy keys providers"],
  ["calendars", "Calendars", "/settings/calendars", "Google ICS subscriptions sharing week start"],
  ["notifications", "Notifications", "/settings#notifications", "Phone ntfy quiet hours reminders test"],
  ["capture", "Browser capture", "/settings/capture", "Chrome extension read later token"],
  ["advanced", "Advanced", "/settings#advanced", "Deployment authentication features version agent access"],
] as const;

export function settingsWorkspace(opts: { category: string; title: string; description: string; body: string; script: string; nav?: NavLink[] }) {
  return workspacePage({
    title: "Settings", description: "Manage this workspace and the services it uses.", active: "/settings", nav: opts.nav,
    body: `<div class="settings-workspace">
<aside class="settings-navigation" aria-label="Settings categories">
<label for="settings-search">Find a setting</label><input id="settings-search" type="search" placeholder="Search settings" autocomplete="off">
<label for="settings-category" class="settings-mobile-label">Category</label>
<select id="settings-category" class="settings-mobile">${categories.map(([id, label, href]) => `<option value="${href}"${id === opts.category ? " selected" : ""}>${label}</option>`).join("")}</select>
<nav class="settings-category-links">${categories.map(([id, label, href, terms]) => `<a href="${href}" data-settings-category="${id}" data-search="${label} ${terms}"${id === opts.category ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
<p id="settings-search-empty" class="dim" hidden>No matching setting. Try a service name, topics, or access.</p>
<div id="settings-search-results" hidden></div>
</aside><div class="settings-content"><header class="settings-content-header"><h2 id="settings-category-title">${opts.title}</h2><p id="settings-category-description" class="dim">${opts.description}</p></header>
${opts.body}</div></div>
<dialog id="settings-leave-dialog" aria-labelledby="settings-leave-title"><h2 id="settings-leave-title">Discard unsaved changes?</h2><p>Your changes have not been saved. Stay to finish editing, or discard them and continue.</p><div class="row"><button id="settings-stay" type="button">Stay</button><button id="settings-discard" type="button" class="ghost">Discard changes</button></div></dialog>
<style>${SETTINGS_WORKSPACE_CSS}</style>`,
    script: SETTINGS_WORKSPACE_SCRIPT + opts.script,
  });
}

export const SETTINGS_WORKSPACE_CSS = `
.settings-workspace{display:grid;grid-template-columns:220px minmax(0,1fr);gap:3rem;align-items:start}
.settings-workspace .dim,.settings-workspace input::placeholder,.settings-workspace textarea::placeholder{color:color-mix(in srgb,var(--muted-foreground) 90%,var(--foreground))}
.settings-navigation{position:sticky;top:1rem}.settings-navigation label{font-size:.8125rem;font-weight:600;display:block;margin-bottom:.5rem}
.settings-navigation input{width:100%;margin-bottom:1rem}.settings-category-links{display:grid;gap:.25rem}
.settings-category-links a{padding:.6rem .75rem;border-radius:6px;color:var(--foreground);text-decoration:none;font-size:.875rem}
.settings-category-links a:hover{background:var(--muted)}.settings-category-links a[aria-current]{background:var(--muted);font-weight:650}
.settings-mobile,.settings-mobile-label{display:none!important}.settings-content{min-width:0;max-width:820px;overflow-wrap:anywhere}
.settings-content-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border)}.settings-content-header h2{font-size:1.4rem;margin:0 0 .4rem}
.settings-content p{line-height:1.6}.settings-group{padding:1.75rem 0;border-bottom:1px solid var(--border)}
.settings-group h3{margin:0 0 .5rem;font-size:1.05rem}.settings-group>p{margin:.5rem 0 1.25rem}
.settings-row{display:flex;justify-content:space-between;align-items:start;gap:1.5rem;padding:.85rem 0}
.settings-row>div:first-child{flex:1;min-width:0}.settings-row label{font-weight:600}.settings-row p{margin:.3rem 0 0}
.settings-row select,.settings-row input[type=time]{width:auto;min-width:140px}.settings-content textarea{width:100%}
.settings-actions{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-top:1.25rem}.settings-actions [role=status]{flex-basis:100%}
.settings-actions[hidden],[hidden]{display:none!important}.settings-scope{font-size:.8125rem}
.settings-content details{margin:1rem 0}.settings-content summary{cursor:pointer;font-weight:600}
.settings-content dl{margin:0}.settings-content dt{font-weight:600;margin-top:1rem}.settings-content dd{margin:.3rem 0}
.settings-content .workspace-form,.settings-content .workspace-details{max-width:none;box-shadow:none;border:0;border-bottom:1px solid var(--border);border-radius:0;padding:1.5rem 0;margin:0}
.settings-content .workspace-details h2{font-size:1.05rem;font-weight:600;margin:0 0 .75rem}
.settings-content button:disabled{opacity:.55;cursor:not-allowed}.settings-content input,.settings-content select{max-width:100%}
#settings-leave-dialog{max-width:min(440px,calc(100vw - 2rem));background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:8px;padding:1.5rem}
#settings-leave-dialog::backdrop{background:rgb(0 0 0 / .4)}#settings-search-results a{display:block;padding:.6rem}
@media(max-width:850px){.settings-workspace{grid-template-columns:1fr;gap:1.5rem}.settings-navigation{position:static}.settings-category-links{display:none}.settings-mobile,.settings-mobile-label{display:block!important}.settings-mobile{width:100%}.settings-row{flex-direction:column;gap:.75rem}.settings-row select,.settings-row input[type=time]{width:100%}.settings-content{max-width:none}}
`;

export const SETTINGS_WORKSPACE_SCRIPT = `
var settingsDrafts=new Map(),settingsNavigationPending=false;
function settingsDirty(){return Array.from(settingsDrafts.values()).some(function(d){return d.dirty()||d.pending;});}
function registerSettingsDraft(id,draft){settingsDrafts.set(id,draft);}
function confirmSettingsLeave(){
  if(!settingsDirty())return Promise.resolve(true);
  if(settingsNavigationPending)return Promise.resolve(false);
  settingsNavigationPending=true;
  return new Promise(function(resolve){
    var dialog=$("settings-leave-dialog"),stay=$("settings-stay"),discard=$("settings-discard");
    function done(leave){dialog.close();settingsNavigationPending=false;resolve(leave);}
    stay.onclick=function(){done(false);};
    discard.onclick=function(){if(Array.from(settingsDrafts.values()).some(function(d){return d.pending;}))return;settingsDrafts.forEach(function(d){d.reset();});done(true);};
    discard.disabled=Array.from(settingsDrafts.values()).some(function(d){return d.pending;});
    dialog.oncancel=function(event){event.preventDefault();done(false);};dialog.showModal();stay.focus();
  });
}
window.addEventListener("beforeunload",function(event){if(settingsDirty()){event.preventDefault();event.returnValue="";}});
document.addEventListener("click",function(event){
  var a=event.target.closest("a[href]");if(!a||event.defaultPrevented||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||a.target||a.hasAttribute("download"))return;
  var target=new URL(a.href,location.href);if(target.href===location.href||!settingsDirty())return;
  event.preventDefault();confirmSettingsLeave().then(function(leave){if(leave)location.href=target.href;});
});
$("settings-category").onchange=function(){var select=this;confirmSettingsLeave().then(function(leave){if(leave)location.href=select.value;else select.value=select.dataset.current;});};
$("settings-category").dataset.current=$("settings-category").value;
$("settings-search").oninput=function(){
  var term=this.value.trim().toLowerCase(),results=$("settings-search-results");results.replaceChildren();results.hidden=!term;
  document.querySelectorAll("[data-settings-category]").forEach(function(link){
    var match=!term||link.dataset.search.toLowerCase().includes(term);link.hidden=!match;
    if(term&&match){var result=link.cloneNode(true);result.removeAttribute("aria-current");results.appendChild(result);}
  });
  $("settings-search-empty").hidden=!term||results.children.length>0;
};
`;
