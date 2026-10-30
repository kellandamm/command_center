import { DEFAULT_SIDEBAR_TABS, visibleNavTabs, type SidebarTab } from "../nav-tabs";
import { COMPONENT_CSS } from "./component-css";
import { formatThemeVars, THEME_DARK, THEME_LIGHT, THEME_META_COLORS } from "./theme-tokens";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Gray neutral + royal blue primary + orange accent (shadcn-style SSR tokens). */
const CSS = `
:root{
  --radius:0.625rem;
  ${formatThemeVars(THEME_LIGHT)};
  --bg:var(--background);--panel:var(--card);--line:var(--border);--fg:var(--foreground);
  --dim:var(--muted-foreground);--bad:var(--destructive);
}
html.dark{
  ${formatThemeVars(THEME_DARK)};
}
${COMPONENT_CSS}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--background);color:var(--foreground);
  font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
h1{font-size:1.875rem;font-weight:600;letter-spacing:-.025em;line-height:1.2;margin:0}
h2{font-size:.875rem;font-weight:600;line-height:1;margin:0 0 .75rem;letter-spacing:-.01em}
code{font-size:.875em;background:var(--muted);padding:.1em .35em;border-radius:calc(var(--radius) - 4px)}
.dim{color:var(--muted-foreground)}.bad{color:var(--destructive)}.ok{color:var(--ok)}
.app-shell{display:flex;min-height:100vh;width:100%}
.sidebar{
  width:15rem;flex-shrink:0;display:flex;flex-direction:column;
  background:var(--sidebar);color:var(--sidebar-foreground);border-right:1px solid var(--sidebar-border);
  padding:.75rem;position:sticky;top:0;height:100vh;z-index:20}
.sidebar-brand{padding:.5rem .75rem 1rem;font-weight:600;font-size:.95rem;letter-spacing:-.02em}
.sidebar-nav{display:flex;flex-direction:column;gap:.25rem;flex:1}
.sidebar-nav a{
  display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;border-radius:calc(var(--radius) - 2px);
  font-size:.875rem;font-weight:500;color:var(--sidebar-foreground);transition:background .15s}
.sidebar-nav a:hover{background:var(--sidebar-accent);color:var(--sidebar-accent-foreground)}
.sidebar-nav a.on{background:var(--sidebar-primary);color:var(--sidebar-primary-foreground);font-weight:600}
.sidebar-footer{padding:.5rem .25rem;border-top:1px solid var(--sidebar-border);margin-top:.5rem}
.app-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.page-content{flex:1;padding:1.5rem 1.25rem 2rem;width:100%;max-width:90rem;margin:0 auto}
.page-header{margin-bottom:1.5rem}
.page-header p{margin:.35rem 0 0;font-size:.875rem}
.panel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,22rem),1fr));gap:1rem;align-items:start}
.card{
  background:var(--card);color:var(--card-foreground);border:1px solid var(--border);
  border-radius:var(--radius);padding:1.25rem;margin:0;
  box-shadow:0 1px 2px rgba(0,0,0,.04)}
html.dark .card{box-shadow:0 1px 2px rgba(0,0,0,.35)}
.row{display:flex;gap:.75rem;flex-wrap:wrap;align-items:center}
button,.btn{
  font:inherit;font-size:.875rem;font-weight:500;
  background:var(--primary);color:var(--primary-foreground);border:1px solid transparent;
  border-radius:calc(var(--radius) - 2px);padding:.5rem 1rem;min-height:2.25rem;cursor:pointer;
  text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:.35rem;
  transition:opacity .15s}
button:hover,.btn:hover{opacity:.92}
button.ghost,.btn.ghost{background:transparent;color:var(--foreground);border-color:var(--border)}
button.ghost:hover,.btn.ghost:hover{background:var(--accent)}
button.ghost[aria-pressed=true],.btn.ghost[aria-pressed=true],button.ghost.on,.btn.ghost.on{
  background:var(--selected);color:var(--selected-foreground);border-color:color-mix(in srgb,var(--primary) 28%,var(--border))}
button.icon-btn{min-width:2.25rem;padding:.5rem}
button:disabled{opacity:.5;cursor:default}
label.field-label{display:block;margin:1rem 0 .35rem;font-size:.875rem;font-weight:500}
label{display:block;margin:1rem 0 .35rem;font-size:.875rem;font-weight:500}
label.choice-row,label.row.choice-row{
  display:flex;align-items:center;gap:.5rem;margin:.35rem 0;font-weight:400;width:fit-content;max-width:100%}
label.choice-row input[type=checkbox],label.choice-row input[type=radio],
label.row.choice-row input[type=checkbox],label.row.choice-row input[type=radio]{
  width:auto;min-height:auto;min-width:auto;margin:0;flex:0 0 auto}
input,select,textarea{
  width:100%;font:inherit;font-size:.875rem;color:var(--foreground);background:var(--background);
  border:1px solid var(--input);border-radius:calc(var(--radius) - 2px);padding:.5rem .75rem;
  box-shadow:0 1px 2px rgba(0,0,0,.03)}
input[type=checkbox],input[type=radio]{width:auto;min-height:auto}
input:focus,select:focus,textarea:focus{outline:2px solid var(--ring);outline-offset:1px}
textarea{font-family:ui-monospace,Menlo,monospace;font-size:.8125rem;min-height:9em}
.settings-card{max-width:42rem}
#briefingTopics{font-family:inherit;font-size:1rem}
.briefing-toolbar{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;margin-bottom:1rem}
.briefing-toolbar select{max-width:12rem}
.briefing-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr));gap:1rem;align-items:start}
.briefing-section{min-height:6rem}
.briefing-section .section-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.5rem}
.briefing-section h2{margin:0}
.status-pill{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:.2em .5em;border-radius:999px;border:1px solid var(--border);color:var(--muted-foreground)}
.status-pill.ok{border-color:color-mix(in srgb,var(--ok) 40%,var(--border));color:var(--ok)}
.status-pill.bad{border-color:color-mix(in srgb,var(--destructive) 40%,var(--border));color:var(--destructive)}
.status-pill.warn{border-color:color-mix(in srgb,var(--warning) 45%,var(--border));color:var(--warning)}
.status-pill.dim{opacity:.85}
.feed-item{border-top:1px solid var(--border);padding:.75rem 0}.feed-item:first-child{border-top:0}
.tag-chip-bar{display:flex;flex-wrap:wrap;gap:.5rem}
.tag-chip{
  font:inherit;font-size:.75rem;font-weight:500;padding:.35rem .65rem;border-radius:999px;
  border:1px solid var(--border);background:var(--secondary);color:var(--secondary-foreground);cursor:pointer}
.tag-chip.on{background:var(--selected);color:var(--selected-foreground);border-color:color-mix(in srgb,var(--primary) 35%,var(--border))}
.tag-chip.muted{opacity:.55;text-decoration:line-through}
.tag-mini{font-size:.65rem;font-weight:600;padding:.15em .45em;border-radius:999px;background:var(--muted);color:var(--muted-foreground)}
.todoist-list{list-style:none;margin:0;padding:0}
.todoist-item{border-top:1px solid var(--border);padding:.625rem 0}.todoist-item:first-child{border-top:0}
.todoist-item input[type=checkbox]{width:auto;margin-top:.25rem;min-height:auto;accent-color:var(--primary)}
pre.briefing{
  white-space:pre-wrap;font:inherit;font-size:.8125rem;background:var(--muted);color:var(--foreground);
  padding:.75rem;border-radius:calc(var(--radius) - 2px);border:1px solid var(--border);max-height:420px;overflow:auto}
.briefing-toolbar{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;margin-bottom:1rem}
.briefing-toolbar select{max-width:12rem}
.status-pill{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:.2em .5em;border-radius:999px;border:1px solid var(--border);color:var(--muted-foreground)}
.status-pill.ok{border-color:color-mix(in srgb,var(--ok) 40%,var(--border));color:var(--ok)}
.status-pill.bad{border-color:color-mix(in srgb,var(--destructive) 40%,var(--border));color:var(--destructive)}
.status-pill.warn{border-color:color-mix(in srgb,var(--warning) 45%,var(--border));color:var(--warning)}
.status-pill.dim{opacity:.85}
pre.briefing.bad{color:var(--destructive);background:transparent;border-color:color-mix(in srgb,var(--destructive) 30%,var(--border))}
.theme-toggle{width:100%;justify-content:flex-start}
.cal-week-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:.5rem}
@media(max-width:900px){.cal-week-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.cal-day{border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);padding:.5rem;min-height:5rem}
.cal-ev{margin-bottom:.5rem;font-size:.8125rem}
.settings-tabs{display:flex;gap:.35rem;margin-bottom:1rem;flex-wrap:wrap}
.settings-tabs button.ghost.on{background:var(--selected);color:var(--selected-foreground);border-color:color-mix(in srgb,var(--primary) 28%,var(--border))}
.settings-tab-panel{display:none}.settings-tab-panel.on{display:block}
.settings-options-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));gap:.75rem}
.settings-option{min-width:0;margin:0;padding:.75rem;border:1px solid var(--border);border-radius:var(--radius)}
.settings-option legend{padding:0 .25rem;font-size:.875rem;font-weight:600}
.settings-option>label:first-child{margin:.1rem 0 .35rem;font-size:.875rem;font-weight:600}
.settings-option>p{margin:.25rem 0 0;font-size:.75rem}
.settings-option label.choice-row{font-size:.8125rem}
.settings-options-grid select{max-width:100%}
.settings-card#tab-views{max-width:70rem}
.compact .page-content{padding:1rem}
.compact .page-header{margin-bottom:.85rem}
.compact .card{padding:.85rem}
.compact .panel-grid,.compact .briefing-grid{gap:.65rem}
.compact .feed-item,.compact .todoist-item{padding:.4rem 0}
.notes-size-small{font-size:.75rem}
.notes-size-medium{font-size:.875rem}
.notes-size-large{font-size:1rem}
.page-content:has(.morning-briefing){max-width:none;padding:clamp(1rem,3vw,2.75rem);background:#f1eee5;color:#191815}
html.dark .page-content:has(.morning-briefing){background:#171610;color:#f0ede3}
.morning-briefing{--paper-ink:#191815;--paper-muted:#68665f;--paper-rule:#bcb8ad;--paper-accent:#a92d1c;max-width:90rem;margin:0 auto}
html.dark .morning-briefing{--paper-ink:#f0ede3;--paper-muted:#b2aea3;--paper-rule:#5c594f;--paper-accent:#e4846a}
.morning-masthead{padding:.25rem 0 1rem;text-align:center}
.morning-kicker{display:flex;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--paper-rule);padding:.25rem 0 .65rem;font-size:.68rem;letter-spacing:.16em;color:var(--paper-muted)}
.morning-masthead h1{margin:.2em 0 0;font-family:Georgia,"Times New Roman",serif;font-size:clamp(3rem,8vw,7.25rem);font-weight:700;letter-spacing:-.065em;line-height:.98;color:var(--paper-ink)}
.morning-deck{margin:.3rem 0 0;font-family:Georgia,"Times New Roman",serif;font-size:clamp(1rem,2vw,1.25rem);font-style:italic;color:var(--paper-muted)}
[hidden]{display:none!important}
.morning-mode{display:flex;gap:.35rem;margin:0 0 .75rem;font-family:ui-sans-serif,system-ui,sans-serif}
.morning-mode button{border:1px solid var(--paper-rule);background:transparent;color:var(--paper-muted);padding:.35rem .75rem;min-height:2rem;font-size:.8rem;letter-spacing:.04em}
.morning-mode button[aria-selected=true]{border-color:var(--paper-ink);color:var(--paper-ink);font-weight:600}
.shutdown-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:1rem 1.25rem;margin-top:.5rem}
.shutdown-section{border-top:1px solid var(--paper-ink);padding-top:.65rem}
.shutdown-section h2{margin:0 0 .5rem;font-family:Georgia,"Times New Roman",serif;font-size:1.15rem}
.shutdown-section ul{list-style:none;padding:0;margin:0}
.shutdown-section li{padding:.35rem 0;border-top:1px dotted var(--paper-rule)}
.shutdown-section li:first-child{border-top:0}
.morning-edition{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-top:3px double var(--paper-ink);border-bottom:2px solid var(--paper-ink);padding:.45rem 0;margin:0 0 1.5rem;font-family:Georgia,"Times New Roman",serif;font-variant:small-caps;letter-spacing:.045em}
.morning-edition label{margin:0}
.morning-edition select{width:auto;max-width:12rem;border:0;padding:.1rem .25rem;background:transparent;color:inherit;font-family:inherit;font-size:.95rem}
.morning-edition-label{white-space:nowrap}
.morning-edition-actions{display:flex;align-items:center;justify-content:flex-end;gap:.65rem;font-family:ui-sans-serif,system-ui,sans-serif;font-variant:normal;letter-spacing:0;font-size:.75rem}
.morning-edition-actions #db-meta{max-width:25rem;text-align:right}
.morning-edition-actions button{white-space:nowrap;padding:.35rem .6rem;min-height:2rem;border-color:var(--paper-rule);color:var(--paper-ink)}
.morning-error{margin:-.75rem 0 1rem;padding:.65rem .8rem;border:1px solid var(--destructive);color:var(--destructive)}
.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.briefing-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(15rem,1fr);gap:1.25rem 1.5rem;align-items:start}
.briefing-section{min-width:0;border:0;border-radius:0;background:transparent;box-shadow:none;padding:0;color:var(--paper-ink)}
.briefing-rail{grid-column:2;grid-row:1/span 4;display:flex;flex-direction:column;gap:1rem}
.briefing-section .section-head{align-items:flex-start;border-bottom:1px solid var(--paper-ink);padding-bottom:.55rem;margin-bottom:.7rem}
.briefing-section .section-head h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:1.45rem;line-height:1.08;letter-spacing:-.025em;color:var(--paper-ink)}
.briefing-kicker{margin:0 0 .3rem;color:var(--paper-accent);font-size:.68rem;font-weight:700;letter-spacing:.16em}
.briefing-section .status-pill{flex-shrink:0;border-color:var(--paper-rule);color:var(--paper-muted)}
.briefing-section .status-pill.ok{color:var(--ok)}
.briefing-section .status-pill.bad{color:var(--destructive)}
.briefing-rail-card{border:1px solid var(--paper-ink);padding:.75rem .85rem}
.briefing-rail-card .section-head{margin-bottom:.35rem}
.briefing-rail-card .section-head h2{font-family:ui-sans-serif,system-ui,sans-serif;font-size:.82rem;line-height:1.2;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.briefing-rail-card .section-head .status-pill{font-size:.58rem}
.briefing-rail-card #db-calendar-body,.briefing-rail-card #db-weather-body{font-family:Georgia,"Times New Roman",serif;font-size:.9rem}
.briefing-rail-card #db-calendar-body ul{list-style:none;padding:0;margin:0}
.briefing-rail-card #db-calendar-body li,.briefing-rail-card .todoist-item{padding:.42rem 0;border-top:1px dotted var(--paper-rule)}
.briefing-rail-card #db-calendar-body li:first-child,.briefing-rail-card .todoist-item:first-child{border-top:0}
.briefing-rail-card #db-weather-body p{margin:.2rem 0}
.briefing-rail-card #db-weather-body p:first-child{font-family:Georgia,"Times New Roman",serif;font-size:1.2rem!important}
.briefing-topics{min-width:0;grid-column:1;grid-row:1}
.briefing-topic{padding-block:1rem;border-top:1px solid var(--paper-rule);overflow-wrap:anywhere}
.briefing-topic h3{font-size:1.15rem;margin:0}
.topic-summary{max-width:70ch;line-height:1.65}
.topic-sources{padding-inline-start:1.5rem;font-size:.875rem}
.topic-sources li{margin-block:.4rem}
.briefing-topics a:hover{text-decoration:underline;text-underline-offset:2px}
.briefing-topics .dim{color:var(--paper-muted)}
.morning-briefing .dim{color:var(--paper-muted)}
@media(max-width:768px){
  .app-shell{flex-direction:column}
  .sidebar{width:100%;height:auto;position:relative;border-right:0;border-bottom:1px solid var(--sidebar-border);padding:.5rem .75rem}
  .sidebar-nav{flex-direction:row;flex-wrap:wrap;gap:.25rem}
  .sidebar-brand{padding:.25rem .5rem .5rem}
  .sidebar-footer{border-top:0;margin-top:0;padding:0 .25rem}
  .theme-toggle{width:auto}
  .page-content{padding:1rem .75rem 1.5rem}
}
@media(max-width:1000px){
  .briefing-grid{grid-template-columns:minmax(0,1fr)}
  .briefing-rail{grid-column:auto;grid-row:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:680px){
  .morning-kicker span:nth-child(2){display:none}
  .morning-edition{flex-wrap:wrap}
  .morning-edition-label{display:none}
  .morning-edition-actions{flex:1 1 100%;flex-wrap:wrap;justify-content:space-between}
  .morning-edition-actions #db-meta{display:block;text-align:left;flex:1;min-width:10rem}
  .briefing-rail{grid-template-columns:minmax(0,1fr)}
}
`;

export type NavLink = { href: string; label: string };

const THEME_SCRIPT = `
(function(){
  var key="cc-theme",root=document.documentElement,meta=document.querySelector('meta[name="theme-color"]');
  function apply(mode){
    var dark=mode==="dark";
    root.classList.toggle("dark",dark);
    if(meta)meta.setAttribute("content",dark?"${THEME_META_COLORS.dark}":"${THEME_META_COLORS.light}");
    var btn=document.getElementById("theme-toggle");
    if(btn)btn.setAttribute("aria-label",dark?"Switch to light mode":"Switch to dark mode");
    if(btn)btn.textContent=dark?"Light mode":"Dark mode";
  }
  var stored=localStorage.getItem(key);
  if(stored==="dark"||stored==="light")apply(stored);
  else apply(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");
  var t=document.getElementById("theme-toggle");
  if(t)t.onclick=function(){
    var next=root.classList.contains("dark")?"light":"dark";
    localStorage.setItem(key,next);apply(next);
  };
})();
`;

export function page(opts: { title: string; body: string; active?: string; script?: string; nav?: NavLink[]; extraCss?: string; extraHead?: string }): string {
  const agentSections = [
    ["/board", "board", "Board"], ["/agent/queue", "queue", "Queue"],
    ["/agent/usage", "usage", "Usage"],
    ["/wins", "wins", "Wins"], ["/assistant", "assistant", "Assistant"], ["/activity", "activity", "Activity"],
  ];
  const agentSection = agentSections.find(([path]) => path === opts.active);
  const active = agentSection ? "/agent" : opts.active;
  const agentNav = agentSection ? `<nav class="agent-tabs" aria-label="Agent sections">${agentSections.map(([, id, label]) =>
    `<a href="/agent?view=${id}"${id === agentSection[1] ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>` : "";
  const links = opts.nav ?? visibleNavTabs(DEFAULT_SIDEBAR_TABS);
  const nav = links
    .map(
      ({ href, label }) =>
        `<a href="${href}"${active === href ? ' class="on"' : ""}><span>${esc(label)}</span></a>`,
    )
    .join("");
  const shell = `<div class="app-shell">
<aside class="sidebar" aria-label="Main navigation">
  <div class="sidebar-brand">Command Center</div>
  <nav class="sidebar-nav">${nav}</nav>
  <div class="sidebar-footer">
    <button type="button" class="ghost theme-toggle icon-btn" id="theme-toggle" aria-label="Toggle theme">Theme</button>
  </div>
</aside>
<div class="app-main"><div class="page-content">${agentNav}${opts.body}</div></div>
</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="${THEME_META_COLORS.light}"><link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<title>${esc(agentSection ? `Agent · ${agentSection[2]} — Command Center` : opts.title)}</title><style>${CSS}${opts.extraCss ?? ""}
.agent-tabs{display:flex;gap:1.5rem;border-bottom:1px solid var(--border);margin-bottom:1.5rem;overflow:auto}
.agent-tabs a{padding:.75rem 0;white-space:nowrap;color:var(--muted-foreground)}
.agent-tabs a[aria-current=page]{color:var(--foreground);border-bottom:2px solid var(--foreground);font-weight:600}
html,body{font-family:Inter,ui-sans-serif,system-ui,sans-serif}</style>${opts.extraHead ?? ""}</head>
<body>${shell}
<script>
${THEME_SCRIPT}
if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(function(){});
window.api=function(path,method,body){return fetch(path,{method:method||"GET",headers:{"x-ah":"1","content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return{}}).then(function(j){if(!r.ok)throw new Error(j.error||("HTTP "+r.status));return j})})};
window.viewPreferencesReady=api("/api/settings").then(function(r){
  var prefs=r.settings&&r.settings.viewPreferences||{};
  document.documentElement.classList.toggle("compact",prefs.density==="compact");
  return prefs;
}).catch(function(err){console.error("Could not load view preferences",err);return null});
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function ownerViewOnlyHint(meta){
  if(!meta||meta.canManage!==false)return "";
  var reason=meta.ownerReason,who=meta.signedInAs||"";
  if(reason==="email-not-in-owner-emails")return "View-only: you're signed in as "+who+", which isn't in OWNER_EMAILS on this server. Add it to OWNER_EMAILS (comma-separated) and restart.";
  if(reason==="no-email-claim")return "View-only: Cloudflare Access did not include an email for this session, so owner access cannot be verified. Sign in with an identity that provides an email claim.";
  if(reason==="service-token")return "View-only: this session used a Cloudflare Access service token, which cannot verify owner access. Sign in with your user identity to manage shared settings.";
  return "View-only: set OWNER_EMAILS and sign in as an owner to change schedules, topics, tabs, and view preferences on this server.";
}
${opts.script ?? ""}
</script></body></html>`;
}
