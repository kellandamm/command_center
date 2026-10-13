export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const CSS = `
:root{--bg:#11141c;--panel:#1a1f2b;--line:#2a3140;--fg:#e8ebf2;--dim:#9aa3b5;--accent:#ffb042;--bad:#ff6b6b;--ok:#5fd38d}
@media(prefers-color-scheme:light){:root{--bg:#f6f7fa;--panel:#fff;--line:#dfe3ec;--fg:#161a24;--dim:#5b6475;--accent:#c46a00;--bad:#c62828;--ok:#1b8a4b}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--accent)}main{max-width:820px;margin:0 auto;padding:20px 16px 110px}
h1{font-size:1.5rem;margin:.2em 0 .6em}h2{font-size:1.1rem;margin:1.6em 0 .5em}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:10px 0}
.dim{color:var(--dim)}.bad{color:var(--bad)}.ok{color:var(--ok)}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
button,.btn{font:inherit;background:var(--accent);color:#1b1305;border:0;border-radius:10px;padding:10px 16px;min-height:44px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
button.ghost,.btn.ghost{background:transparent;color:var(--fg);border:1px solid var(--line)}button:disabled{opacity:.5;cursor:default}
label{display:block;margin:14px 0 4px;font-weight:600}input,select,textarea{width:100%;font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px}
textarea{font-family:ui-monospace,Menlo,monospace;font-size:.9rem;min-height:9em}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.dock{position:fixed;left:50%;transform:translateX(-50%);bottom:max(12px,env(safe-area-inset-bottom));display:flex;gap:4px;background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:6px;box-shadow:0 6px 24px #0006;z-index:10}
.dock{max-width:calc(100vw - 16px)}.dock a{color:var(--fg);text-decoration:none;padding:10px 12px;border-radius:999px;min-height:44px;display:inline-flex;align-items:center;font-size:.95rem}
.dock a.on{background:var(--accent);color:#1b1305}pre.log{white-space:pre-wrap;font-size:.8rem;max-height:320px;overflow:auto;background:var(--bg);padding:10px;border-radius:10px;border:1px solid var(--line)}
.bar{height:8px;background:var(--bg);border-radius:6px;overflow:hidden}.bar>i{display:block;height:100%;background:var(--accent)}
@media(max-width:430px){.dock a{padding:10px 8px;font-size:.85rem}}
iframe#page{position:fixed;inset:0 0 76px 0;height:calc(100% - 76px);width:100%;border:0;background:Canvas}
`;

const NAV = [
  ["/", "Today"], ["/archive", "Archive"], ["/status", "Status"], ["/settings", "Settings"], ["/extension", "Extension"],
] as const;

export function page(opts: { title: string; body: string; active?: string; script?: string; fullBleed?: boolean }): string {
  const dock = `<nav class="dock">${NAV.map(([href, label]) => `<a href="${href}"${opts.active === href ? ' class="on"' : ""}>${label}</a>`).join("")}</nav>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#11141c"><link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/icon-192.png">
<title>${esc(opts.title)}</title><style>${CSS}</style></head>
<body>${opts.fullBleed ? opts.body : `<main>${opts.body}</main>`}${dock}
<script>
if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(function(){});
window.api=function(path,method,body){return fetch(path,{method:method||"GET",headers:{"x-ah":"1","content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return{}}).then(function(j){if(!r.ok)throw new Error(j.error||("HTTP "+r.status));return j})})};
${opts.script ?? ""}
</script></body></html>`;
}
