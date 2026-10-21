import type { NavLink } from "./layout";
import { workspacePage, workspaceTabs } from "./workspace";

export function sourcesPage(nav?: NavLink[], library = false): string {
  return workspacePage({
    title: library ? "Library" : "Read later",
    description: library ? "Find the articles and source material you chose to keep." : "Only what you choose to save. No feeds, subscriptions, or unread treadmill.",
    active: library ? "/library" : "/read-later", nav,
    actions: '<a class="btn ghost" href="/settings/capture">Set up Chrome capture</a>',
    tabs: workspaceTabs(library ? [["/library", "All saved"], ["/library?view=summarized", "Summarized"], ["/library?view=archive", "Archived"]] :
      [["/read-later", "Inbox"], ["/library", "Browse library"]], library ? "/library" : "/read-later"),
    body: `<div class="workspace-toolbar"><label class="sr-only" for="source-search">Search saved pages</label><input id="source-search" type="search" placeholder="Search titles, text, and summaries"></div>
${library ? "" : `<details class="workspace-details"><summary>Save a page without the extension</summary>
<form id="capture-form" class="workspace-inline-form"><label for="capture-url">Page URL</label><input id="capture-url" type="url" required placeholder="https://">
<label for="capture-title">Title</label><input id="capture-title" maxlength="240" placeholder="Optional">
<label for="capture-text">Article text</label><textarea id="capture-text" maxlength="20000" placeholder="Paste the text you want to keep or summarize. We never fetch private pages behind your back."></textarea>
<div class="row"><button type="submit" value="save">Save</button><button type="submit" value="summarize" class="ghost">Save &amp; summarize</button></div></form></details>`}
<div id="source-list" class="workspace-list"></div>`,
    script: `
var sources=[],library=${library};
var view=new URLSearchParams(location.search).get("view")||(library?"all":"inbox");
document.querySelectorAll(".workspace-tabs a").forEach(function(a){a.toggleAttribute("aria-current",a.getAttribute("href")===location.pathname+location.search);if(a.hasAttribute("aria-current"))a.setAttribute("aria-current","page");});
function renderSources(){
  var q=$("source-search").value.toLowerCase(),box=$("source-list");box.replaceChildren();
  var rows=sources.filter(function(s){return (view!=="summarized"||s.summary)&&(s.title+" "+s.excerpt+" "+(s.summary||"")+" "+s.tags.join(" ")).toLowerCase().includes(q);});
  if(!rows.length){emptyState(box,q?"Nothing matches that search":library?"Your library is ready for something worth keeping":"Nothing waiting to be read",q?"Try a different title, phrase, or tag.":"Save a page with Chrome capture, or paste an article into Read later.");return;}
  rows.forEach(function(s){
    var row=element("a",undefined,"workspace-item");row.href=(library?"/library/":"/read-later/")+encodeURIComponent(s.id);
    var text=element("div");text.append(element("div",s.title,"workspace-item-title"),element("p",host(s.url)+" · "+(s.summary?"Summary ready":"Not summarized")+(s.archivedAt?" · Archived":"")));
    if(s.summary)text.append(element("p",s.summary.slice(0,180)+(s.summary.length>180?"…":"")));
    row.append(text,element("span",new Date(s.createdAt).toLocaleDateString(),"workspace-meta"));box.append(row);
  });
}
async function loadSources(){var r=await api("/api/read-later?view="+encodeURIComponent(view==="summarized"?"all":view));sources=r.sources;renderSources();}
$("source-search").oninput=renderSources;
var form=$("capture-form");
if(form)form.onsubmit=function(e){e.preventDefault();var summarize=e.submitter.value==="summarize";busy(e.submitter,async function(){
  var r=await api("/api/read-later","POST",{url:$("capture-url").value,title:$("capture-title").value||undefined,excerpt:$("capture-text").value,summarize:summarize});
  await loadSources();message((r.duplicate?"Already in your library.":"Page saved.")+(r.summaryError?" Summary failed: "+r.summaryError:""),!!r.summaryError);
  if(!r.summaryError)form.reset();
});};
loadSources().catch(fail);`,
  });
}

export function sourceDetailPage(nav?: NavLink[]): string {
  return workspacePage({
    title: "Saved page", description: "Read, understand, and put a useful idea to work.", active: "/read-later", nav,
    actions: '<a class="btn ghost" href="/read-later">Back to Read later</a>',
    body: `<main class="reading-column" id="source-detail" hidden><p id="source-origin" class="dim"></p><h1 id="source-title"></h1>
<div class="reading-actions"><a id="source-original" class="btn ghost" target="_blank" rel="noopener noreferrer">Open original</a><button id="source-summarize" type="button">Summarize</button><button id="source-archive" class="ghost" type="button">Archive</button></div>
<section class="reading-summary"><h2>Summary</h2><p id="source-summary" class="reading-text"></p></section>
<details id="source-text-details" class="workspace-details"><summary>Captured article text</summary><p id="source-text" class="reading-text"></p></details>
<section class="workspace-details"><h2>Put it to work</h2><div class="row"><button id="source-note" class="ghost" type="button">Create a note</button><button id="source-task-toggle" class="ghost" type="button">Create a board task</button><a id="source-ask" class="btn ghost" href="/assistant">Ask the Assistant</a></div>
<form id="source-task-form" hidden><label for="source-task-title">Task title</label><input id="source-task-title" maxlength="200" required><button type="submit">Add to board</button></form>
<label for="source-space">Organize in a space</label><select id="source-space"></select><button id="source-space-save" class="ghost" type="button">Save space</button>
<p id="source-result" class="workspace-result" role="status"></p></section>
<details class="workspace-details"><summary>Edit captured material</summary><form id="source-edit-form">
<label for="source-edit-title">Title</label><input id="source-edit-title" required maxlength="240"><label for="source-edit-text">Article text</label><textarea id="source-edit-text" maxlength="20000"></textarea>
<label for="source-tags">Tags</label><input id="source-tags" placeholder="Comma-separated"><p class="dim">Changing article text clears its old summary so you can summarize the updated material.</p><button type="submit">Save changes</button></form></details></main>`,
    script: `
var id=decodeURIComponent(location.pathname.split("/").pop()),source=null,spaces=[];
function renderSource(){
  $("source-detail").hidden=false;$("source-title").textContent=source.title;document.title=source.title+" — Command Center";
  $("source-origin").textContent=host(source.url)+" · Saved "+new Date(source.createdAt).toLocaleDateString();
  var url=safeLink(source.url);$("source-original").hidden=!url;if(url)$("source-original").href=url;
  $("source-summary").textContent=source.summary||"No summary yet. Summarize when you want help understanding this page.";
  $("source-summarize").disabled=!!source.summary;$("source-summarize").textContent=source.summary?"Summarized":"Summarize";
  $("source-text").textContent=source.excerpt||"No article text was captured. Add text below before summarizing.";if(!source.summary)$("source-text-details").open=true;
  $("source-archive").textContent=source.archivedAt?"Move to inbox":"Archive";
  spaceOptions($("source-space"),spaces);$("source-space").value=source.spaceId||"";
  $("source-ask").href="/assistant?source="+encodeURIComponent(source.id);
  $("source-edit-title").value=source.title;$("source-edit-text").value=source.excerpt;$("source-tags").value=source.tags.join(", ");
}
async function updateSource(body){var r=await api("/api/knowledge/sources/"+encodeURIComponent(id),"PUT",body);source=r.source;renderSource();}
$("source-summarize").onclick=function(){busy(this,async function(){message("Summarizing…");var r=await api("/api/read-later/"+encodeURIComponent(id)+"/summarize","POST",{});source=r.source;renderSource();message("Summary ready.");});};
$("source-archive").onclick=function(){busy(this,async function(){await updateSource({archived:!source.archivedAt});message(source.archivedAt?"Archived. Still available in Library and its space.":"Moved to Read later.");});};
$("source-space-save").onclick=function(){var selected=$("source-space").value;busy(this,async function(){await updateSource({spaceId:selected||null});message("Space updated.");});};
$("source-note").onclick=function(){busy(this,async function(){var r=await api("/api/knowledge/notes","POST",{title:source.title,content:source.summary||source.excerpt,sourceUrl:source.url,tags:source.tags,spaceId:source.spaceId});var box=$("source-result");box.replaceChildren(appLink("Note created. Open it →","/notes?note="+encodeURIComponent(r.note.id)));});};
$("source-task-toggle").onclick=function(){$("source-task-form").hidden=!$("source-task-form").hidden;$("source-task-title").value=source.title;$("source-task-title").focus();};
$("source-task-form").onsubmit=function(e){e.preventDefault();busy(e.submitter,async function(){await api("/api/board/cards","POST",{title:$("source-task-title").value,notes:((source.url||"")+"\\n\\n"+(source.summary||source.excerpt)).slice(0,8000)});$("source-task-form").hidden=true;$("source-result").replaceChildren(appLink("Task created. Open board →","/board"));});};
$("source-edit-form").onsubmit=function(e){e.preventDefault();busy(e.submitter,async function(){await updateSource({title:$("source-edit-title").value,excerpt:$("source-edit-text").value,tags:$("source-tags").value.split(",").map(function(t){return t.trim();}).filter(Boolean)});message("Changes saved.");});};
api("/api/knowledge").then(function(data){source=data.sources.find(function(s){return s.id===id;});spaces=data.spaces;if(!source)throw new Error("Saved page not found. Return to Read later.");renderSource();}).catch(fail);
`,
  });
}
