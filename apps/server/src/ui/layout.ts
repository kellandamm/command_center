import { dashboardGridCss } from "./dashboard-grid";
import { DEFAULT_SIDEBAR_TABS, visibleNavTabs, type SidebarTab } from "../nav-tabs";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** shadcn/ui default theme tokens (studio-admin baseline), SSR — no Tailwind build. */
const CSS = `
:root{
  --radius:0.625rem;
  --background:#ffffff;--foreground:#0a0a0a;
  --card:#ffffff;--card-foreground:#0a0a0a;
  --primary:#171717;--primary-foreground:#fafafa;
  --secondary:#f5f5f5;--secondary-foreground:#171717;
  --muted:#f5f5f5;--muted-foreground:#737373;
  --accent:#f5f5f5;--accent-foreground:#171717;
  --destructive:#dc2626;--border:#e5e5e5;--input:#e5e5e5;--ring:#a3a3a3;
  --sidebar:#fafafa;--sidebar-foreground:#0a0a0a;--sidebar-border:#e5e5e5;
  --sidebar-accent:#f5f5f5;--sidebar-accent-foreground:#171717;
  --bg:var(--background);--panel:var(--card);--line:var(--border);--fg:var(--foreground);
  --dim:var(--muted-foreground);--bad:var(--destructive);--ok:#16a34a;
}
html.dark{
  --background:#0a0a0a;--foreground:#fafafa;
  --card:#171717;--card-foreground:#fafafa;
  --primary:#fafafa;--primary-foreground:#171717;
  --secondary:#262626;--secondary-foreground:#fafafa;
  --muted:#262626;--muted-foreground:#a3a3a3;
  --accent:#262626;--accent-foreground:#fafafa;
  --destructive:#ef4444;--border:rgba(255,255,255,.1);--input:rgba(255,255,255,.15);--ring:#737373;
  --sidebar:#171717;--sidebar-foreground:#fafafa;--sidebar-border:rgba(255,255,255,.1);
  --sidebar-accent:#262626;--sidebar-accent-foreground:#fafafa;
  --ok:#4ade80;
}
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
.sidebar-nav a.on{background:var(--sidebar-accent);color:var(--sidebar-accent-foreground)}
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
button.ghost:hover{background:var(--accent)}
button.icon-btn{min-width:2.25rem;padding:.5rem}
button:disabled{opacity:.5;cursor:default}
label{display:block;margin:1rem 0 .35rem;font-size:.875rem;font-weight:500}
input,select,textarea{
  width:100%;font:inherit;font-size:.875rem;color:var(--foreground);background:var(--background);
  border:1px solid var(--input);border-radius:calc(var(--radius) - 2px);padding:.5rem .75rem;
  box-shadow:0 1px 2px rgba(0,0,0,.03)}
input:focus,select:focus,textarea:focus{outline:2px solid var(--ring);outline-offset:1px}
textarea{font-family:ui-monospace,Menlo,monospace;font-size:.8125rem;min-height:9em}
.settings-card{max-width:42rem}
.briefing-toolbar{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;margin-bottom:1rem}
.briefing-toolbar select{max-width:12rem}
.briefing-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr));gap:1rem;align-items:start}
.briefing-section{min-height:6rem}
.briefing-section .section-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.5rem}
.briefing-section h2{margin:0}
.status-pill{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:.2em .5em;border-radius:999px;border:1px solid var(--border);color:var(--muted-foreground)}
.status-pill.ok{border-color:color-mix(in srgb,var(--ok) 40%,var(--border));color:var(--ok)}
.status-pill.bad{border-color:color-mix(in srgb,var(--destructive) 40%,var(--border));color:var(--destructive)}
.status-pill.dim{opacity:.85}
.feed-item{border-top:1px solid var(--border);padding:.75rem 0}.feed-item:first-child{border-top:0}
.tag-chip-bar{display:flex;flex-wrap:wrap;gap:.5rem}
.tag-chip{
  font:inherit;font-size:.75rem;font-weight:500;padding:.35rem .65rem;border-radius:999px;
  border:1px solid var(--border);background:var(--secondary);color:var(--secondary-foreground);cursor:pointer}
.tag-chip.on{background:var(--primary);color:var(--primary-foreground);border-color:transparent}
.tag-chip.muted{opacity:.55;text-decoration:line-through}
.tag-mini{font-size:.65rem;font-weight:600;padding:.15em .45em;border-radius:999px;background:var(--muted);color:var(--muted-foreground)}
.news-compact-list{max-height:32rem;overflow:auto;border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);padding:0 .75rem}
.news-row{border-top:1px solid var(--border);padding:.75rem 0}.news-row:first-child{border-top:0}
.news-list-card{padding-bottom:1rem}
.page-content.rss-page{max-width:none;padding:.75rem 1rem 1rem;min-height:calc(100vh - 2rem);display:flex;flex-direction:column;gap:.5rem}
.rss-topics.card{padding:.75rem 1rem;margin:0}
.rss-workspace{display:flex;flex:1;min-height:0;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;background:var(--card)}
.rss-sidebar{width:14rem;flex-shrink:0;border-right:1px solid var(--border);display:flex;flex-direction:column;min-height:0;background:var(--sidebar)}
.rss-sidebar-head{padding:.65rem .75rem;border-bottom:1px solid var(--border);font-weight:600;font-size:.8125rem}
.rss-tree{flex:1;overflow:auto;padding:.35rem 0;font-size:.8125rem}
.rss-tree button.tree-item{width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:.35rem .75rem;border-radius:0;min-height:auto;justify-content:flex-start;font-weight:500}
.rss-tree button.tree-item:hover,.rss-tree button.tree-item.on{background:var(--sidebar-accent)}
.rss-tree .tree-feed{padding-left:1.25rem;font-weight:400;font-size:.75rem}
.rss-tree .tree-folder-row{display:flex;align-items:center;gap:.15rem;width:100%}
.rss-tree .tree-folder-row .tree-item{flex:1;min-width:0;display:flex}
.rss-tree button.tree-toggle{width:1.25rem;flex-shrink:0;padding:0;border:0;background:transparent;color:var(--muted-foreground);cursor:pointer;font-size:.7rem;line-height:1}
.rss-tree button.tree-gear{width:1.5rem;flex-shrink:0;padding:0;border:0;background:transparent;color:var(--muted-foreground);cursor:pointer;font-size:.75rem;opacity:.6}
.rss-tree button.tree-gear:hover{opacity:1}
.rss-tree .tree-feed-row{display:flex;align-items:center;gap:.25rem;padding-right:.35rem}
.rss-tree .tree-feed-row .tree-item{flex:1}
.rss-tree select.tree-feed-move{max-width:4.5rem;font-size:.65rem;padding:.1rem .2rem;height:1.35rem}
.rss-tree .count{margin-left:auto;font-size:.7rem;color:var(--muted-foreground)}
.rss-main{flex:1;display:flex;min-width:0;min-height:0}
.rss-list-pane{flex:1;display:flex;flex-direction:column;min-width:0;border-right:1px solid var(--border)}
.rss-list-pane.with-reader{max-width:42%}
.rss-toolbar{padding:.5rem .75rem;border-bottom:1px solid var(--border);gap:.5rem;flex-wrap:wrap}
.rss-toolbar input[type=search]{max-width:14rem;flex:1;min-width:8rem}
.rss-articles{flex:1;overflow:auto}
.rss-row{display:grid;grid-template-columns:5.5rem 1fr auto;gap:.5rem .75rem;padding:.45rem .75rem;border-bottom:1px solid var(--border);cursor:pointer;align-items:start}
.rss-row:hover{background:var(--muted)}
.rss-row.unread .rss-title{font-weight:600}
.rss-row .src{font-size:.7rem;color:var(--muted-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rss-row .rss-title{font-size:.8125rem;line-height:1.35;margin:0}
.rss-row .snippet{font-size:.75rem;color:var(--muted-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;grid-column:2/4}
.rss-row .age{font-size:.7rem;color:var(--muted-foreground);white-space:nowrap}
.rss-row.card-view{grid-template-columns:5rem 1fr;grid-template-rows:auto auto auto;padding:.75rem}
.rss-row.card-view .snippet{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rss-row .thumb{width:4.5rem;height:2.5rem;object-fit:cover;border-radius:4px;background:var(--muted)}
.rss-row.card-view .thumb{width:4.5rem;height:3rem}
.rss-read-pane{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.rss-read-pane.hidden{display:none}
.rss-read-head{padding:.75rem 1rem;border-bottom:1px solid var(--border)}
.rss-read-body{flex:1;overflow:auto;padding:1rem;font-size:.875rem;line-height:1.55}
.rss-read-body img{max-width:100%;height:auto}
.rss-yt-badge{font-size:.65rem;background:var(--muted);padding:.1rem .35rem;border-radius:3px;margin-right:.35rem}
@media(max-width:960px){.rss-workspace{flex-direction:column}.rss-sidebar{width:100%;max-height:10rem}.rss-list-pane.with-reader{max-width:none}.rss-read-pane{min-height:12rem}}
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
.status-pill.dim{opacity:.85}
pre.briefing.bad{color:var(--destructive);background:transparent;border-color:color-mix(in srgb,var(--destructive) 30%,var(--border))}
.theme-toggle{width:100%;justify-content:flex-start}
.cal-week-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:.5rem}
@media(max-width:900px){.cal-week-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.cal-day{border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);padding:.5rem;min-height:5rem}
.cal-ev{margin-bottom:.5rem;font-size:.8125rem}
.dashboard-panel-chrome h2 a{text-decoration:none;color:inherit}
.dashboard-panel-chrome h2 a:hover{text-decoration:underline}
.settings-tabs{display:flex;gap:.35rem;margin-bottom:1rem;flex-wrap:wrap}
.settings-tabs button.ghost.on{background:var(--sidebar-accent)}
.settings-tab-panel{display:none}.settings-tab-panel.on{display:block}
${dashboardGridCss}
@media(max-width:768px){
  .app-shell{flex-direction:column}
  .sidebar{width:100%;height:auto;position:relative;border-right:0;border-bottom:1px solid var(--sidebar-border);padding:.5rem .75rem}
  .sidebar-nav{flex-direction:row;flex-wrap:wrap;gap:.25rem}
  .sidebar-brand{padding:.25rem .5rem .5rem}
  .sidebar-footer{border-top:0;margin-top:0;padding:0 .25rem}
  .theme-toggle{width:auto}
  .page-content{padding:1rem .75rem 1.5rem}
}
`;

export type NavLink = { href: string; label: string };

const THEME_SCRIPT = `
(function(){
  var key="cc-theme",root=document.documentElement,meta=document.querySelector('meta[name="theme-color"]');
  function apply(mode){
    var dark=mode==="dark";
    root.classList.toggle("dark",dark);
    if(meta)meta.setAttribute("content",dark?"#0a0a0a":"#ffffff");
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

export function page(opts: { title: string; body: string; active?: string; script?: string; nav?: NavLink[] }): string {
  const links = opts.nav ?? visibleNavTabs(DEFAULT_SIDEBAR_TABS);
  const nav = links
    .map(
      ({ href, label }) =>
        `<a href="${href}"${opts.active === href ? ' class="on"' : ""}><span>${esc(label)}</span></a>`,
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
<div class="app-main"><div class="page-content">${opts.body}</div></div>
</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#ffffff"><link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<title>${esc(opts.title)}</title><style>${CSS}html,body{font-family:Inter,ui-sans-serif,system-ui,sans-serif}</style></head>
<body>${shell}
<script>
${THEME_SCRIPT}
if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(function(){});
window.api=function(path,method,body){return fetch(path,{method:method||"GET",headers:{"x-ah":"1","content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return{}}).then(function(j){if(!r.ok)throw new Error(j.error||("HTTP "+r.status));return j})})};
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
${opts.script ?? ""}
</script></body></html>`;
}
