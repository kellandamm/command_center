import { DEFAULT_SIDEBAR_TABS, visibleSidebarTabs, type SidebarGroup, type SidebarTab } from "../nav-tabs";
import { COMPONENT_CSS } from "./component-css";
import { ICONS, icon, type IconName } from "./icons";
import { formatThemeVars, THEME_DARK, THEME_LIGHT, THEME_META_COLORS } from "./theme-tokens";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Gray neutral + royal blue primary + orange accent (shadcn-style SSR tokens). */
const CSS = `
:root{
  --radius:0.75rem;
  --sidebar-width:16rem;--sidebar-width-icon:3rem;--topbar-h:3.5rem;--inset-gap:0.5rem;
  --page-pad:1.5rem;--section-gap:1.5rem;--grid-gap:1rem;--card-pad:1.25rem;
  --font-mono:ui-monospace,"JetBrains Mono","SF Mono",Menlo,monospace;
  ${formatThemeVars(THEME_LIGHT)};
  --bg:var(--background);--panel:var(--card);--line:var(--border);--fg:var(--foreground);
  --dim:var(--muted-foreground);--bad:var(--destructive);
}
html.compact{--page-pad:1rem;--card-pad:0.875rem;--grid-gap:0.75rem}
html.dark{
  ${formatThemeVars(THEME_DARK)};
}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--background);color:var(--foreground);
  font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
h1{font-size:1.5rem;font-weight:600;letter-spacing:-.025em;line-height:1.2;margin:0}
.tabular-nums{font-variant-numeric:tabular-nums}
.num{font-variant-numeric:tabular-nums;font-family:var(--font-mono)}
h2{font-size:.875rem;font-weight:600;line-height:1;margin:0 0 .75rem;letter-spacing:-.01em}
code{font-size:.875em;background:var(--muted);padding:.1em .35em;border-radius:calc(var(--radius) - 4px)}
.dim{color:var(--muted-foreground)}.bad{color:var(--destructive)}.ok{color:var(--ok)}
.app-shell{display:flex;min-height:100vh;width:100%;background:var(--sidebar)}
.app-shell[data-sidebar-state=collapsed] .sidebar{width:var(--sidebar-width-icon)}
.app-shell[data-sidebar-state=collapsed] .sidebar-label,.app-shell[data-sidebar-state=collapsed] .sidebar-group-label,
.app-shell[data-sidebar-state=collapsed] .sidebar-brand-text,.app-shell[data-sidebar-state=collapsed] .sidebar-user-meta,
.app-shell[data-sidebar-state=collapsed] .sidebar-subnav{display:none}
.app-shell[data-sidebar-state=collapsed] .sidebar-nav a{justify-content:center;padding:.5rem}
.sidebar{
  width:var(--sidebar-width);flex-shrink:0;display:flex;flex-direction:column;
  background:var(--sidebar);color:var(--sidebar-foreground);padding:.75rem .5rem;
  position:sticky;top:0;height:100vh;z-index:30;transition:width .2s ease}
.sidebar-header{padding:.25rem .5rem .75rem}
.sidebar-brand{display:flex;align-items:center;gap:.65rem;padding:.35rem .5rem;text-decoration:none;color:inherit}
.sidebar-logo{
  width:2rem;height:2rem;border-radius:calc(var(--radius) - 2px);background:var(--primary);color:var(--primary-foreground);
  display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.75rem;flex-shrink:0}
.sidebar-brand-text{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.sidebar-brand-text strong{font-size:.875rem;font-weight:600;letter-spacing:-.02em}
.sidebar-brand-text span{font-size:.6875rem;color:var(--muted-foreground)}
.sidebar-content{flex:1;overflow-y:auto;overflow-x:hidden;padding:0 .25rem;display:flex;flex-direction:column;gap:.75rem}
.sidebar-group{display:flex;flex-direction:column;gap:.2rem}
.sidebar-group-label{padding:.25rem .75rem;font-size:.75rem;font-weight:500;color:color-mix(in srgb,var(--sidebar-foreground) 70%,transparent)}
.sidebar-nav{display:flex;flex-direction:column;gap:.125rem}
.sidebar-nav a{
  display:flex;align-items:center;gap:.5rem;padding:.375rem .75rem;border-radius:calc(var(--radius) - 2px);
  font-size:.875rem;font-weight:500;color:var(--sidebar-foreground);transition:background .15s;min-height:2rem}
.sidebar-nav a:hover{background:var(--sidebar-accent);color:var(--sidebar-accent-foreground)}
.sidebar-nav a.on{background:var(--sidebar-primary);color:var(--sidebar-primary-foreground);font-weight:600}
.sidebar-nav a.sidebar-sub{padding-left:2.25rem;font-size:.8125rem;min-height:1.75rem}
.ui-icon{display:inline-flex;flex-shrink:0;align-items:center;justify-content:center;width:1rem;height:1rem}
.ui-icon svg{display:block}
.sidebar-footer{margin-top:auto;padding:.5rem .25rem 0;border-top:1px solid var(--sidebar-border)}
.sidebar-footer .sidebar-nav{margin:0;padding:0 .25rem}
.sidebar-user{display:flex;align-items:center;gap:.5rem;padding:.5rem .35rem;margin-top:.35rem;border-radius:calc(var(--radius) - 2px)}
.sidebar-user-avatar{
  width:2rem;height:2rem;border-radius:calc(var(--radius) - 2px);background:var(--muted);color:var(--muted-foreground);
  display:flex;align-items:center;justify-content:center;font-size:.6875rem;font-weight:600;flex-shrink:0}
.sidebar-user-meta{min-width:0;font-size:.8125rem;line-height:1.25}
.sidebar-user-meta strong{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sidebar-user-meta span{display:block;font-size:.6875rem;color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sidebar-inset{
  flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;margin:var(--inset-gap);
  border-radius:1rem;background:var(--background);box-shadow:0 1px 2px rgba(0,0,0,.06);overflow:hidden}
.topbar{
  position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:.75rem;height:var(--topbar-h);
  padding:0 1rem;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--background) 80%,transparent);
  backdrop-filter:blur(8px);flex-shrink:0}
.topbar-start{display:flex;align-items:center;gap:.5rem;min-width:0;flex:1}
.topbar-sep{width:1px;height:1.25rem;background:var(--border);flex-shrink:0}
.topbar-breadcrumb{display:flex;align-items:center;gap:.35rem;min-width:0;font-size:.875rem;color:var(--muted-foreground);flex-wrap:wrap}
.topbar-breadcrumb a{color:inherit}
.topbar-breadcrumb a:hover{color:var(--primary)}
.topbar-breadcrumb [aria-current=page]{color:var(--foreground);font-weight:500}
.topbar-breadcrumb-sep{display:inline-flex;opacity:.6}
.topbar-actions{display:flex;align-items:center;gap:.35rem;flex-shrink:0}
.page-body{
  flex:1;padding:var(--page-pad);display:flex;flex-direction:column;gap:var(--section-gap);
  background:color-mix(in srgb,var(--muted) 40%,transparent);min-width:0}
.page-content,.page-body-inner{flex:1;width:100%;min-width:0}
.page-read-width{max-width:90rem;margin:0 auto;width:100%}
.page-header{margin-bottom:0}
.page-header p{margin:.35rem 0 0;font-size:.875rem}
.sidebar-backdrop{display:none}
.agent-tabs-mobile{display:none}
.panel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,22rem),1fr));gap:1rem;align-items:start}
.card{
  background:var(--card);color:var(--card-foreground);border:0;
  border-radius:calc(var(--radius) + 0.25rem);padding:var(--card-pad);margin:0;
  box-shadow:0 0 0 1px color-mix(in srgb,var(--foreground) 6%,transparent),0 1px 2px rgba(0,0,0,.04)}
html.dark .card{box-shadow:0 0 0 1px color-mix(in srgb,var(--foreground) 10%,transparent),0 1px 2px rgba(0,0,0,.35)}
.row{display:flex;gap:.75rem;flex-wrap:wrap;align-items:center}
button,.btn{
  font:inherit;font-size:.875rem;font-weight:500;
  background:var(--primary);color:var(--primary-foreground);border:1px solid transparent;
  border-radius:calc(var(--radius) - 2px);padding:.5rem 1rem;min-height:2.25rem;cursor:pointer;
  text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:.35rem;
  transition:opacity .15s}
button:hover,.btn:hover{opacity:.92}
button.ghost,.btn.ghost{background:transparent;color:var(--foreground);border-color:var(--border)}
button.ghost:hover,.btn.ghost:hover{background:var(--muted);color:var(--foreground)}
button.ghost[aria-pressed=true],.btn.ghost[aria-pressed=true],button.ghost.on,.btn.ghost.on{
  background:var(--selected);color:var(--selected-foreground);border-color:color-mix(in srgb,var(--primary) 28%,var(--border))}
button.icon-btn{min-width:2.25rem;padding:.5rem}
button:disabled{opacity:.5;cursor:default}
${COMPONENT_CSS}
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
.compact .page-header{margin-bottom:.85rem}
.compact .panel-grid,.compact .briefing-grid{gap:.65rem}
@media(max-width:768px){:root{--page-pad:1rem}}
.compact .feed-item,.compact .todoist-item{padding:.4rem 0}
.notes-size-small{font-size:.75rem}
.notes-size-medium{font-size:.875rem}
.notes-size-large{font-size:1rem}
.page-body:has(.morning-briefing),.page-body-inner:has(.morning-briefing){
  max-width:none;padding:clamp(1rem,3vw,2.75rem);background:#f1eee5;color:#191815}
html.dark .page-body:has(.morning-briefing),html.dark .page-body-inner:has(.morning-briefing){
  background:#171610;color:#f0ede3}
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
  .app-shell{--inset-gap:0}
  .sidebar{
    position:fixed;left:0;top:0;bottom:0;width:min(18rem,88vw);transform:translateX(-105%);
    transition:transform .2s ease,visibility .2s ease;box-shadow:0 8px 32px rgba(0,0,0,.2);z-index:50}
  .app-shell[data-mobile-sidebar=closed] .sidebar{visibility:hidden}
  .app-shell[data-mobile-sidebar=open] .sidebar{transform:translateX(0);visibility:visible}
  .app-shell[data-mobile-sidebar=open] .sidebar-backdrop{display:block}
  .sidebar-backdrop{
    position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:40;border:0;padding:0;cursor:pointer}
  .sidebar-inset{margin:0;border-radius:0;min-height:100vh}
  .agent-tabs-mobile{display:flex;gap:1rem;border-bottom:1px solid var(--border);margin-bottom:1rem;overflow:auto}
  .agent-tabs-mobile a{padding:.65rem 0;white-space:nowrap;color:var(--muted-foreground);font-size:.875rem}
  .agent-tabs-mobile a[aria-current=page]{color:var(--foreground);border-bottom:2px solid var(--foreground);font-weight:600}
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
  var sun=${JSON.stringify(ICONS.sun)},moon=${JSON.stringify(ICONS.moon)};
  function apply(mode){
    var dark=mode==="dark";
    root.classList.toggle("dark",dark);
    if(meta)meta.setAttribute("content",dark?"${THEME_META_COLORS.dark}":"${THEME_META_COLORS.light}");
    var btn=document.getElementById("theme-toggle");
    if(btn){btn.setAttribute("aria-label",dark?"Switch to light mode":"Switch to dark mode");btn.innerHTML=dark?sun:moon;}
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
(function(){
  var key="cc-sidebar",shell=document.querySelector(".app-shell");
  if(!shell)return;
  var sidebar=shell.querySelector(".sidebar");
  var stored=localStorage.getItem(key);
  if(stored==="collapsed"||stored==="expanded")shell.setAttribute("data-sidebar-state",stored);
  else shell.setAttribute("data-sidebar-state","expanded");
  function isMobile(){return window.matchMedia("(max-width:768px)").matches}
  function syncToggleAria(){
    var btn=document.getElementById("sidebar-toggle");
    if(!btn)return;
    if(isMobile())btn.setAttribute("aria-expanded",shell.getAttribute("data-mobile-sidebar")==="open"?"true":"false");
    else btn.setAttribute("aria-expanded",shell.getAttribute("data-sidebar-state")==="collapsed"?"false":"true");
  }
  function focusFirstSidebarWhenVisible(){
    if(!sidebar)return;
    var done=false;
    function focusIt(){
      if(done)return;
      done=true;
      sidebar.removeEventListener("transitionend",onEnd);
      var target=sidebar.querySelector(".sidebar-nav a,.sidebar-brand");
      if(target&&target.focus)target.focus();
    }
    function onEnd(ev){
      if(ev.target!==sidebar)return;
      if(ev.propertyName==="transform"||ev.propertyName==="visibility")focusIt();
    }
    sidebar.addEventListener("transitionend",onEnd);
    setTimeout(focusIt,280);
  }
  function resetMobileSheetState(){
    shell.setAttribute("data-mobile-sidebar","closed");
    if(sidebar){sidebar.removeAttribute("inert");sidebar.removeAttribute("aria-hidden");}
    syncToggleAria();
  }
  function setMobileOpen(open){
    shell.setAttribute("data-mobile-sidebar",open?"open":"closed");
    if(sidebar){
      if(open){sidebar.removeAttribute("inert");sidebar.removeAttribute("aria-hidden");focusFirstSidebarWhenVisible();}
      else{sidebar.setAttribute("inert","");sidebar.setAttribute("aria-hidden","true");document.getElementById("sidebar-toggle")?.focus();}
    }
    syncToggleAria();
  }
  function setState(next){
    shell.setAttribute("data-sidebar-state",next);
    document.documentElement.setAttribute("data-sidebar-state",next);
    localStorage.setItem(key,next);
    syncToggleAria();
  }
  function toggle(){
    if(isMobile())setMobileOpen(shell.getAttribute("data-mobile-sidebar")!=="open");
    else setState(shell.getAttribute("data-sidebar-state")==="collapsed"?"expanded":"collapsed");
  }
  function sidebarShortcutBlocked(){
    var el=document.activeElement;
    if(!el||!el.tagName)return false;
    var tag=el.tagName;
    if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT")return true;
    if(el.isContentEditable)return true;
    if(el.closest&&el.closest("#knowledge-editor,#notes-editor,.notes-editor,[contenteditable=true]"))return true;
    return false;
  }
  if(isMobile()&&shell.getAttribute("data-mobile-sidebar")!=="open"&&sidebar){
    sidebar.setAttribute("inert","");sidebar.setAttribute("aria-hidden","true");
  }
  syncToggleAria();
  var mobileMq=window.matchMedia("(max-width:768px)");
  function onViewportChange(){
    if(!isMobile())resetMobileSheetState();
    else if(shell.getAttribute("data-mobile-sidebar")!=="open"&&sidebar){
      sidebar.setAttribute("inert","");sidebar.setAttribute("aria-hidden","true");
    }
    syncToggleAria();
  }
  mobileMq.addEventListener("change",onViewportChange);
  document.getElementById("sidebar-toggle")?.addEventListener("click",toggle);
  document.getElementById("sidebar-backdrop")?.addEventListener("click",function(){setMobileOpen(false);});
  document.addEventListener("click",function(ev){
    var menu=document.querySelector(".page-header-menu[open]");
    if(!menu||menu.contains(ev.target))return;
    menu.removeAttribute("open");
  });
  document.addEventListener("keydown",function(ev){
    if(ev.key==="Escape"){
      if(isMobile()&&shell.getAttribute("data-mobile-sidebar")==="open"){ev.preventDefault();setMobileOpen(false);return;}
      var menu=document.querySelector(".page-header-menu[open]");
      if(menu){ev.preventDefault();menu.removeAttribute("open");menu.querySelector("summary")?.focus();return;}
    }
    if((ev.metaKey||ev.ctrlKey)&&ev.key.toLowerCase()==="b"){
      if(sidebarShortcutBlocked())return;
      ev.preventDefault();toggle();
    }
  });
})();
`;

const SIDEBAR_BOOT_SCRIPT = `(function(){var s=localStorage.getItem("cc-sidebar");if(s==="collapsed"||s==="expanded")document.documentElement.setAttribute("data-sidebar-state",s);else document.documentElement.setAttribute("data-sidebar-state","expanded");})();`;

const DEFAULT_BY_HREF = new Map(DEFAULT_SIDEBAR_TABS.map((t) => [t.href, t]));

function tabsFromNav(links: NavLink[]): SidebarTab[] {
  return links.map((link, i) => {
    const base = DEFAULT_BY_HREF.get(link.href);
    if (base) return { ...base, label: link.label };
    return {
      id: "dashboard",
      href: link.href,
      label: link.label,
      visible: true,
      order: i,
      group: "workspace" as SidebarGroup,
      icon: "layoutDashboard",
    };
  });
}

const AGENT_SUB_NAV: Array<{ sectionId: string; href: string; label: string; icon: IconName }> = [
  { sectionId: "board", href: "/agent?view=board", label: "Board", icon: "listTodo" },
  { sectionId: "queue", href: "/agent?view=queue", label: "Queue", icon: "listTodo" },
  { sectionId: "usage", href: "/agent?view=usage", label: "Usage", icon: "barChart" },
  { sectionId: "wins", href: "/agent?view=wins", label: "Wins", icon: "trophy" },
  { sectionId: "assistant", href: "/agent?view=assistant", label: "Assistant", icon: "messageSquare" },
  { sectionId: "activity", href: "/agent?view=activity", label: "Activity", icon: "activity" },
];

const GROUP_ORDER: SidebarGroup[] = ["workspace", "library", "agent"];
const GROUP_LABELS: Record<SidebarGroup, string> = {
  workspace: "Workspace",
  library: "Library",
  agent: "Agent",
};

function sidebarLink(tab: SidebarTab, isOn: boolean, extraClass = ""): string {
  const cls = [isOn ? "on" : "", extraClass].filter(Boolean).join(" ");
  const classAttr = cls ? ` class="${cls}"` : "";
  const ic = ICONS[tab.icon as IconName] ? icon(tab.icon as IconName) : "";
  return `<a href="${esc(tab.href)}"${classAttr} title="${esc(tab.label)}">${ic}<span class="sidebar-label">${esc(tab.label)}</span></a>`;
}

const AGENT_ACTIVE_MAP: Record<string, string> = {
  "/board": "board",
  "/agent/queue": "queue",
  "/agent/usage": "usage",
  "/agent": "board",
  "/wins": "wins",
  "/assistant": "assistant",
  "/activity": "activity",
};

function agentSectionIdFromActive(active?: string): string | undefined {
  if (!active) return undefined;
  return AGENT_ACTIVE_MAP[active];
}

function renderSidebarGroups(tabs: SidebarTab[], activeHref: string, agentSectionId?: string): string {
  const visible = tabs.filter((t) => (t.visible || t.locked) && t.id !== "settings");
  return GROUP_ORDER.map((group) => {
    if (group === "agent") {
      const agentTab = visible.find((t) => t.id === "agent");
      if (!agentTab) return "";
      const subs = AGENT_SUB_NAV.map((sub) => {
        const subOn = agentSectionId === sub.sectionId;
        return `<a href="${esc(sub.href)}" class="sidebar-sub${subOn ? " on" : ""}" title="${esc(sub.label)}">${icon(sub.icon)}<span class="sidebar-label">${esc(sub.label)}</span></a>`;
      }).join("");
      const parentOn = activeHref === "/agent" && !agentSectionId;
      return `<div class="sidebar-group"><div class="sidebar-group-label">${GROUP_LABELS.agent}</div><nav class="sidebar-nav sidebar-subnav">${sidebarLink(agentTab, parentOn)}${subs}</nav></div>`;
    }
    const items = visible.filter((t) => t.group === group);
    if (!items.length) return "";
    return `<div class="sidebar-group"><div class="sidebar-group-label">${GROUP_LABELS[group]}</div><nav class="sidebar-nav">${items.map((t) => sidebarLink(t, activeHref === t.href)).join("")}</nav></div>`;
  }).join("");
}

function breadcrumbHtml(opts: {
  active?: string;
  agentSection?: (typeof AGENT_SUB_NAV)[number] | undefined;
  crumbs?: Array<{ label: string; href?: string }>;
  pageTitle: string;
}): string {
  if (opts.crumbs?.length) {
    return opts.crumbs
      .map((c, i) => {
        const last = i === opts.crumbs!.length - 1;
        const sep = last ? "" : `<span class="topbar-breadcrumb-sep" aria-hidden="true">${icon("chevronRight")}</span>`;
        const inner = c.href && !last ? `<a href="${esc(c.href)}">${esc(c.label)}</a>` : `<span${last ? ' aria-current="page"' : ""}>${esc(c.label)}</span>`;
        return `${inner}${sep}`;
      })
      .join("");
  }
  if (opts.agentSection) {
    return `<a href="/agent">Agent</a><span class="topbar-breadcrumb-sep" aria-hidden="true">${icon("chevronRight")}</span><span aria-current="page">${esc(opts.agentSection.label)}</span>`;
  }
  const label =
    opts.active === "/"
      ? "Dashboard"
      : opts.pageTitle.replace(/\s*—\s*Command Center.*/i, "").trim() || "Command Center";
  return `<span aria-current="page">${esc(label)}</span>`;
}

export function page(opts: {
  title: string;
  body: string;
  active?: string;
  script?: string;
  nav?: NavLink[];
  extraCss?: string;
  extraHead?: string;
  crumbs?: Array<{ label: string; href?: string }>;
  readWidth?: boolean;
}): string {
  const agentSectionId = agentSectionIdFromActive(opts.active);
  const agentSectionMeta = agentSectionId ? AGENT_SUB_NAV.find((s) => s.sectionId === agentSectionId) : undefined;
  const activeHref = agentSectionId ? "/agent" : (opts.active ?? "");
  const agentNavMobile = agentSectionId
    ? `<nav class="agent-tabs-mobile" aria-label="Agent sections">${AGENT_SUB_NAV.map((sub) => {
        const subOn = agentSectionId === sub.sectionId;
        return `<a href="${esc(sub.href)}"${subOn ? ' aria-current="page"' : ""}>${esc(sub.label)}</a>`;
      }).join("")}</nav>`
    : "";
  const tabs = opts.nav ? tabsFromNav(opts.nav) : visibleSidebarTabs(DEFAULT_SIDEBAR_TABS);
  const settingsTab = tabs.find((t) => t.href === "/settings") ?? DEFAULT_SIDEBAR_TABS.find((t) => t.id === "settings")!;
  const sidebarGroups = renderSidebarGroups(tabs, activeHref, agentSectionId);
  const crumbs = breadcrumbHtml({
    active: opts.active,
    agentSection: agentSectionMeta,
    crumbs: opts.crumbs,
    pageTitle: opts.title,
  });
  const bodyWrapClass = opts.readWidth ? "page-body-inner page-read-width" : "page-body-inner";
  const shell = `<div class="app-shell" data-sidebar-state="expanded" data-mobile-sidebar="closed">
<button type="button" class="sidebar-backdrop" id="sidebar-backdrop" aria-label="Close navigation"></button>
<aside class="sidebar" aria-label="Main navigation">
  <div class="sidebar-header">
    <a class="sidebar-brand" href="/">
      <span class="sidebar-logo" aria-hidden="true">CC</span>
      <span class="sidebar-brand-text"><strong>Command Center</strong><span>command.gobison.io</span></span>
    </a>
  </div>
  <div class="sidebar-content">${sidebarGroups}</div>
  <div class="sidebar-footer">
    <nav class="sidebar-nav" aria-label="Settings">${sidebarLink(settingsTab, activeHref === settingsTab.href)}</nav>
    <div class="sidebar-user" id="sidebar-user">
      <span class="sidebar-user-avatar" id="sidebar-user-initials" aria-hidden="true">?</span>
      <span class="sidebar-user-meta"><strong id="sidebar-user-name">Signed in</strong><span id="sidebar-user-email" class="dim">Loading…</span></span>
    </div>
  </div>
</aside>
<main class="sidebar-inset">
  <header class="topbar">
    <div class="topbar-start">
      <button type="button" class="ghost btn-icon" id="sidebar-toggle" aria-label="Toggle sidebar" aria-expanded="true">${icon("panelLeft")}</button>
      <span class="topbar-sep" aria-hidden="true"></span>
      <nav class="topbar-breadcrumb" aria-label="Breadcrumb">${crumbs}</nav>
    </div>
    <div class="topbar-actions">
      <button type="button" class="ghost theme-toggle btn-icon" id="theme-toggle" aria-label="Toggle theme">${ICONS.sun}</button>
    </div>
  </header>
  <div class="page-body"><div class="${bodyWrapClass}">${agentNavMobile}${opts.body}</div></div>
</main>
</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<script>${SIDEBAR_BOOT_SCRIPT}</script>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="${THEME_META_COLORS.light}"><link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<title>${esc(agentSectionMeta ? `Agent · ${agentSectionMeta.label} — Command Center` : opts.title)}</title><style>${CSS}${opts.extraCss ?? ""}
html,body{font-family:Inter,ui-sans-serif,system-ui,sans-serif}
html[data-sidebar-state=collapsed] .app-shell .sidebar{width:var(--sidebar-width-icon)}
html[data-sidebar-state=collapsed] .app-shell .sidebar-label,
html[data-sidebar-state=collapsed] .app-shell .sidebar-group-label,
html[data-sidebar-state=collapsed] .app-shell .sidebar-brand-text,
html[data-sidebar-state=collapsed] .app-shell .sidebar-user-meta,
html[data-sidebar-state=collapsed] .app-shell .sidebar-subnav{display:none}
html[data-sidebar-state=collapsed] .app-shell .sidebar-nav a{justify-content:center;padding:.5rem}
</style>${opts.extraHead ?? ""}</head>
<body>${shell}
<script>
${THEME_SCRIPT}
if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(function(){});
(function(){
  var shell=document.querySelector(".app-shell");
  var boot=document.documentElement.getAttribute("data-sidebar-state");
  if(shell&&boot)shell.setAttribute("data-sidebar-state",boot);
})();
window.api=function(path,method,body){return fetch(path,{method:method||"GET",headers:{"x-ah":"1","content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return{}}).then(function(j){if(!r.ok)throw new Error(j.error||("HTTP "+r.status));return j})})};
window.viewPreferencesReady=api("/api/settings").then(function(r){
  var prefs=r.settings&&r.settings.viewPreferences||{};
  document.documentElement.classList.toggle("compact",prefs.density==="compact");
  var meta=r.meta||{};
  if(meta.signedInAs){
    var email=String(meta.signedInAs);
    var el=document.getElementById("sidebar-user-email");if(el)el.textContent=email;
    var ini=document.getElementById("sidebar-user-initials");
    if(ini)ini.textContent=email.slice(0,2).toUpperCase();
    var name=document.getElementById("sidebar-user-name");
    if(name)name.textContent=email.split("@")[0]||"Signed in";
  }
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
