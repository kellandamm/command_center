import { esc, page, type NavLink } from "./layout";

export const workspaceCss = `
.page-content{--cp-text-muted:var(--muted-foreground);--cp-border:var(--border);--cp-accent:var(--primary);--cp-danger:var(--destructive);--cp-surface-soft:var(--muted);--cp-accent-soft:var(--accent);--cp-link:var(--foreground);--cp-success:var(--ok)}
.workspace-details.library-capture{margin:0 0 1.5rem;padding:0;border:0}
.library-capture summary{color:var(--muted-foreground);font-weight:400}
.library-capture a{text-decoration:underline;text-underline-offset:3px}
.workspace-tabs.library-views{gap:1.5rem;overflow-x:auto;flex-wrap:nowrap}
.library-views a{white-space:nowrap}
.library-views span{font-size:.8rem;margin-left:.35rem;color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.library-controls{display:grid;grid-template-columns:minmax(14rem,1fr) repeat(3,minmax(8rem,auto));align-items:end;gap:1rem}
.library-controls label{font-size:.8rem;color:var(--muted-foreground)}
.library-controls input,.library-controls select{margin:0;width:100%}
.library-results{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin:1.25rem 0 .5rem}
.library-results button[aria-pressed=true]{background:var(--accent);border-color:var(--ring)}
.library-items{border-top:1px solid var(--border)}
.library-item{display:flex;gap:1rem;padding:1.5rem 0;border-bottom:1px solid var(--border);align-items:start;min-width:0}
.library-domain-mark{display:grid;place-items:center;flex:0 0 2.5rem;height:2.5rem;background:var(--muted);border-radius:var(--radius);color:var(--muted-foreground);font-weight:600}
.library-item-content{flex:1;min-width:0}
.library-item h2{font-size:1.05rem;line-height:1.5;margin:.25rem 0 .5rem;overflow-wrap:anywhere}
.library-item h2 a:hover{text-decoration:underline;text-underline-offset:3px}
.library-origin{font-size:.8rem;color:var(--muted-foreground);margin:0;overflow-wrap:anywhere}
.library-preview{margin:.25rem 0 .75rem;max-width:72ch;line-height:1.6;color:var(--muted-foreground);overflow-wrap:anywhere}
.library-labels{display:flex;flex-wrap:wrap;gap:.5rem 1rem;font-size:.8rem;color:var(--muted-foreground);align-items:center}
.library-labels a{text-decoration:underline;text-underline-offset:3px}
.library-labels .library-tag{padding:0;min-height:1.5rem;background:none;border:0;color:inherit;font-size:inherit;font-weight:400}
.library-tag:hover{text-decoration:underline}
.library-summary-label{color:var(--foreground)}
.library-item-actions{display:flex;gap:.5rem;flex-wrap:wrap}
.library-item-actions button{font-size:.8rem;padding:.4rem .65rem}
.library-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,18rem),1fr));gap:1rem;border:0}
.library-cards .library-item{flex-wrap:wrap;border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem}
.library-cards .library-item-content{flex-basis:calc(100% - 3.5rem)}
.library-cards .library-item-actions{width:100%;padding-top:.5rem}
.library-items .workspace-empty{grid-column:1/-1}
.reading-manager{display:grid;grid-template-columns:12rem minmax(0,1fr);gap:1.5rem}
.reading-organizer{border-right:1px solid var(--border);padding-right:1rem;min-width:0}
.reading-organizer>details>summary{font-weight:600;cursor:pointer;margin-bottom:1.25rem}
.reading-organizer h2{margin:1.5rem 0 .5rem}
.reading-organizer p{font-size:.8rem}
.reading-organizer nav{max-height:22rem;overflow:auto}
.reading-folder{display:flex;justify-content:space-between;gap:.75rem;width:100%;text-align:left;background:none;color:var(--foreground);padding:.4rem .5rem;font-size:.85rem}
.reading-folder span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.reading-folder[aria-pressed=true]{background:var(--accent)}
.reading-new-folder{margin-top:.75rem}
.reading-new-folder summary{cursor:pointer;font-size:.85rem}
.reading-new-folder input{width:100%;min-width:0}
.reading-collection{min-width:0}
.reading-pagination{display:flex;justify-content:center;align-items:center;gap:1rem;padding:1rem 0}
.reading-pagination span{font-size:.85rem;color:var(--muted-foreground)}
.reading-organize summary{cursor:pointer;min-height:2rem;padding:.4rem .65rem;border:1px solid var(--border);border-radius:var(--radius);font-size:.8rem}
.reading-organize form{width:min(18rem,100%);padding:.75rem 0}
.reading-organize input,.reading-organize select{width:100%;min-width:0}
.reading-compact .library-item{padding:.5rem 0;gap:.75rem;align-items:center;flex-wrap:nowrap;min-height:4rem}
.reading-compact .library-domain-mark{flex-basis:1.75rem;height:1.75rem;font-size:.8rem}
.reading-compact .library-item-content{display:flex;flex-direction:column;min-width:0;gap:.15rem}
.reading-compact .library-item h2{font-size:.9rem;line-height:1.35;margin:0;order:-1}
.reading-compact .library-item h2 a{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.reading-compact .library-origin{font-size:.75rem}
.reading-compact .library-preview{display:none}
.reading-compact .library-labels{display:none}
.reading-compact .library-item-actions{flex-shrink:0;margin:0;gap:.25rem}
.reading-compact .library-item:has(.reading-organize[open]){align-items:start}
.reading-compact .reading-organize[open] form{width:14rem}
.reading-collection .library-controls{grid-template-columns:minmax(0,1fr) auto}
.reading-collection .library-controls .library-search{grid-column:auto}
.reading-collection .library-controls>div:last-child{grid-column:auto}
@media(max-width:1150px){.reading-manager{grid-template-columns:10rem minmax(0,1fr);gap:1rem}.reading-compact .library-item-actions{flex-wrap:wrap;max-width:15rem}}
@media(max-width:750px){.reading-manager{grid-template-columns:1fr}.reading-organizer{border-right:0;border-bottom:1px solid var(--border);padding:0 0 .75rem}.reading-organizer>details:not([open])>summary{margin:0}.reading-organizer nav{max-height:12rem}.reading-compact .library-item{flex-wrap:wrap}.reading-compact .library-item-content{flex-basis:100%}.reading-compact .library-domain-mark{display:none}.reading-compact .library-item-actions{width:100%;max-width:none}.reading-compact .reading-organize[open] form{width:100%}}
@media(max-width:950px){.library-controls{grid-template-columns:repeat(3,minmax(0,1fr))}.library-search{grid-column:1/-1}.library-item{flex-wrap:wrap}.library-item-actions{margin-left:3.5rem}}
@media(max-width:500px){.library-controls{grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.library-search,.library-controls>div:last-child{grid-column:1/-1}.library-item-actions{margin-left:0;width:100%}.library-domain-mark{display:none}.library-results{flex-wrap:wrap}.library-cards .library-item-content{flex-basis:100%}}
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
