import { esc, page, type NavLink } from "./layout";

export const workspaceCss = `
.workspace-head{display:flex;justify-content:space-between;align-items:start;gap:1rem;margin-bottom:1.5rem}
.workspace-head p{margin:.5rem 0 0;color:var(--cp-text-muted);max-width:65ch}
.workspace-tabs{display:flex;flex-wrap:wrap;gap:1.25rem;border-bottom:1px solid var(--cp-border);margin-bottom:1.5rem}
.workspace-tabs a{padding:.75rem 0;color:var(--cp-text-muted)}
.workspace-tabs a[aria-current=page]{color:var(--cp-accent);border-bottom:2px solid var(--cp-accent);font-weight:600}
.workspace-toolbar{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;margin-bottom:1.25rem}
.workspace-toolbar input{max-width:30rem}
.workspace-status{min-height:1.5rem;margin:.75rem 0;color:var(--cp-text-muted)}
.workspace-status.bad{color:var(--cp-danger)}
.workspace-empty{padding:3rem 1.5rem;border:1px dashed var(--cp-border);border-radius:1rem;text-align:center}
.workspace-empty p{color:var(--cp-text-muted);max-width:50ch;margin:.75rem auto}
.workspace-list{border-top:1px solid var(--cp-border)}
.workspace-item{display:flex;justify-content:space-between;align-items:start;gap:1rem;padding:1.1rem .25rem;border-bottom:1px solid var(--cp-border)}
.workspace-item:hover{background:var(--cp-surface-soft)}
.workspace-item-title{font-size:1rem;font-weight:600;overflow-wrap:anywhere}
.workspace-item p{margin:.3rem 0 0;color:var(--cp-text-muted);max-width:70ch;overflow-wrap:anywhere}
.workspace-meta{font-size:.8125rem;color:var(--cp-text-muted);white-space:nowrap}
.workspace-editor{display:grid;grid-template-columns:16rem minmax(0,1fr);gap:2rem}
.workspace-editor aside{border-right:1px solid var(--cp-border);padding-right:1rem}
.note-pick{display:block;width:100%;text-align:left;justify-content:start;margin-bottom:.35rem;overflow-wrap:anywhere}
.note-pick[aria-current=true]{background:var(--cp-accent-soft);color:var(--cp-accent)}
.note-document input.note-title{font-size:1.6rem;font-weight:600;border:0;padding:.5rem 0;background:transparent;box-shadow:none}
.note-document textarea{min-height:26rem;resize:vertical;border:0;background:transparent;padding:1rem 0;font:1rem/1.75 "Segoe UI",Aptos,Calibri,sans-serif;box-shadow:none}
.note-document>label{color:var(--cp-text-muted)}
.workspace-details{margin-top:1.5rem;border-top:1px solid var(--cp-border);padding-top:1rem}
.workspace-details summary{cursor:pointer;font-weight:600}
.workspace-form{max-width:46rem}
.workspace-form .row>div{flex:1;min-width:12rem}
.reading-column{max-width:72ch;margin:0 auto}
.reading-column h1{font-size:2rem;line-height:1.25;overflow-wrap:anywhere}
.reading-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:1rem;line-height:1.8}
.reading-summary{margin:2rem 0;padding:1.25rem;background:var(--cp-accent-soft);border-radius:1rem}
.reading-summary h2{color:var(--cp-accent)}
.reading-actions{display:flex;flex-wrap:wrap;gap:.5rem;margin:1.5rem 0}
.workspace-answer{white-space:pre-wrap;line-height:1.8;font-size:1rem;margin:1.5rem 0;overflow-wrap:anywhere}
.workspace-citations{display:flex;flex-wrap:wrap;gap:.5rem}
.workspace-citations a{color:var(--cp-link);text-decoration:underline}
.workspace-inline-form{padding:1rem 0 1.5rem;max-width:46rem}
.workspace-result{padding:.75rem 0;color:var(--cp-success)}
:focus-visible{outline:2px solid var(--cp-accent);outline-offset:3px}
[hidden]{display:none!important}
@media(max-width:850px){.workspace-editor{grid-template-columns:1fr;gap:1rem}.workspace-editor aside{border-right:0;border-bottom:1px solid var(--cp-border);padding:0 0 1rem;max-height:14rem;overflow:auto}.workspace-head{flex-wrap:wrap}.workspace-item{flex-direction:column;gap:.5rem}.workspace-meta{white-space:normal}.note-document textarea{min-height:20rem}}
@media(prefers-reduced-motion:no-preference){.workspace-result{animation:workspace-result .2s ease-out}@keyframes workspace-result{from{transform:translateY(3px)}to{transform:translateY(0)}}}
`;

export function workspaceTabs(items: Array<[string, string]>, active: string): string {
  return `<nav class="workspace-tabs" aria-label="Section">${items.map(([href, label]) =>
    `<a href="${esc(href)}"${href === active ? ' aria-current="page"' : ""}>${esc(label)}</a>`).join("")}</nav>`;
}

export const workspaceScript = `
var $=function(id){return document.getElementById(id);};
function element(tag,text,cls){var e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function appLink(text,href,cls){var a=element("a",text,cls);a.href=href;return a;}
function message(text,bad){var box=$("workspace-status");box.textContent=text;box.classList.toggle("bad",!!bad);}
function fail(err){message(err.message||"Request failed. Try again.",true);}
async function busy(button,fn){button.disabled=true;try{await fn();}catch(err){fail(err);}finally{button.disabled=false;}}
function emptyState(box,title,detail){box.replaceChildren();var e=element("div",undefined,"workspace-empty");e.append(element("h2",title),element("p",detail));box.append(e);}
function safeLink(raw){try{var u=new URL(raw);return ["https:","http:"].includes(u.protocol)?u.href:null;}catch(_){return null;}}
function host(raw){try{return new URL(raw).hostname;}catch(_){return "Saved text";}}
function spaceOptions(select,spaces,label){select.replaceChildren(new Option(label||"No space",""));spaces.forEach(function(s){select.add(new Option(s.name,s.id));});}
`;

export function workspacePage(opts: {
  title: string; description: string; active: string; nav?: NavLink[];
  body: string; script: string; tabs?: string; actions?: string;
}): string {
  return page({
    title: `${opts.title} — Command Center`, active: opts.active, nav: opts.nav, extraCss: workspaceCss,
    body: `<header class="workspace-head"><div><h1>${esc(opts.title)}</h1><p>${esc(opts.description)}</p></div>${opts.actions ?? ""}</header>
${opts.tabs ?? ""}${opts.body}<p id="workspace-status" class="workspace-status" role="status" aria-live="polite"></p>`,
    script: `${workspaceScript}\n${opts.script}`,
  });
}
