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
.app-main{flex:1;min-width:0;display:flex;flex-direction:column}
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
.feed-item{border-top:1px solid var(--border);padding:.75rem 0}.feed-item:first-child{border-top:0}
.todoist-list{list-style:none;margin:0;padding:0}
.todoist-item{border-top:1px solid var(--border);padding:.625rem 0}.todoist-item:first-child{border-top:0}
.todoist-item input[type=checkbox]{width:auto;margin-top:.25rem;min-height:auto;accent-color:var(--primary)}
pre.briefing{
  white-space:pre-wrap;font:inherit;font-size:.8125rem;background:var(--muted);color:var(--foreground);
  padding:.75rem;border-radius:calc(var(--radius) - 2px);border:1px solid var(--border);max-height:420px;overflow:auto}
.theme-toggle{width:100%;justify-content:flex-start}
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

const NAV = [
  ["/", "Dashboard"],
  ["/settings", "Settings"],
] as const;

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

export function page(opts: { title: string; body: string; active?: string; script?: string }): string {
  const nav = NAV.map(
    ([href, label]) =>
      `<a href="${href}"${opts.active === href ? ' class="on"' : ""}><span>${esc(label)}</span></a>`,
  ).join("");
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
