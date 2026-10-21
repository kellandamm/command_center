import type { NavLink } from "./layout";
import { workspacePage } from "./workspace";

export function sourcesPage(nav?: NavLink[]): string {
  return workspacePage({
    title: "Read Later",
    description: "Save, organize, and summarize the things worth keeping.",
    active: "/library", nav,
    actions: '<button id="source-add" type="button">Save a link</button>',
    body: `<details id="capture-panel" class="workspace-details library-capture"><summary>Save a link without the extension</summary>
<p class="dim">For one-click saving, <a href="/settings/capture">set up Chrome capture</a>.</p>
<form id="capture-form" class="workspace-inline-form"><label for="capture-url">Page URL</label><input id="capture-url" type="url" required placeholder="https://">
<label for="capture-title">Title</label><input id="capture-title" maxlength="240" placeholder="Optional">
<label for="capture-text">Page text</label><textarea id="capture-text" maxlength="20000" placeholder="Paste text to read or summarize. Chrome capture can do this for you."></textarea>
<label for="capture-space">Folder (Space)</label><select id="capture-space"></select>
<label for="capture-tags">Tags</label><input id="capture-tags" placeholder="design, research">
<div class="row"><button type="submit" value="save">Save</button><button type="submit" value="summarize" class="ghost">Save &amp; summarize</button></div></form></details>
<div class="reading-manager"><aside class="reading-organizer" aria-label="Folders and tags">
<details id="organizer-panel" open><summary>Folders &amp; tags</summary>
<h2>Folders</h2><p class="dim">Folders are shared Spaces.</p><nav id="folder-list" aria-label="Folders"></nav>
<details class="reading-new-folder"><summary>New folder</summary><form id="folder-form">
<label for="folder-name">Folder name</label><input id="folder-name" required maxlength="120"><button type="submit" class="ghost">Create folder</button></form></details>
<h2>Tags</h2><nav id="tag-list" aria-label="Tags"></nav></details></aside>
<section class="reading-collection" aria-label="Saved articles">
<nav class="workspace-tabs library-views" aria-label="Read Later filters">
<a href="/library" data-library-view="all">All saved <span id="count-all">0</span></a>
<a href="/library?view=inbox" data-library-view="inbox">Inbox <span id="count-inbox">0</span></a>
<a href="/library?view=summarized" data-library-view="summarized">Summarized <span id="count-summarized">0</span></a>
<a href="/library?view=archive" data-library-view="archive">Archived <span id="count-archive">0</span></a></nav>
<div class="library-controls">
<div class="library-search"><label class="sr-only" for="source-search">Search saved links</label><input id="source-search" type="search" placeholder="Search links, text, tags, summaries"></div>
<div hidden><label for="source-space-filter">Folder</label><select id="source-space-filter"><option value="">All folders</option></select></div>
<div hidden><label for="source-tag-filter">Tag</label><select id="source-tag-filter"><option value="">All tags</option></select></div>
<div><label for="source-sort">Sort</label><select id="source-sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title A-Z</option></select></div>
</div>
<div class="library-results"><p id="source-count" class="dim" role="status">Loading saved links...</p>
<div class="row" role="group" aria-label="Link layout"><button id="source-compact-view" class="ghost" type="button" aria-pressed="true">Compact</button><button id="source-list-view" class="ghost" type="button" aria-pressed="false">List</button><button id="source-card-view" class="ghost" type="button" aria-pressed="false">Cards</button></div></div>
<div id="source-list" class="library-items" aria-busy="true"></div>
<nav class="reading-pagination" aria-label="Article pages"><button id="source-prev" type="button" class="ghost">Previous</button><span id="source-page" role="status"></span><button id="source-next" type="button" class="ghost">Next</button></nav>
</section></div>`,
    script: `
var sources=[],spaces=[],params=new URLSearchParams(location.search);
var view=["all","inbox","summarized","archive"].includes(params.get("view"))?params.get("view"):"all";
var layout=["cards","list","compact"].includes(params.get("layout"))?params.get("layout"):"compact",cards=layout==="cards";
var pageNumber=Math.max(1,Math.floor(Number(params.get("page"))||1)),pageSize=50;
if(matchMedia("(max-width:750px)").matches)$("organizer-panel").open=false;
function updateUrl(){
  var next=new URLSearchParams();
  if(view!=="all")next.set("view",view);
  [["q","source-search"],["space","source-space-filter"],["tag","source-tag-filter"]].forEach(function(pair){if($(pair[1]).value)next.set(pair[0],$(pair[1]).value);});
  if($("source-sort").value!=="newest")next.set("sort",$("source-sort").value);
  if(layout!=="compact")next.set("layout",layout);
  if(pageNumber>1)next.set("page",String(pageNumber));
  history.replaceState(null,"","/library"+(next.size?"?"+next.toString():""));
}
function renderSources(){
  var q=$("source-search").value.trim().toLowerCase(),space=$("source-space-filter").value,tag=$("source-tag-filter").value,box=$("source-list");
  box.replaceChildren();box.classList.toggle("library-cards",cards);box.classList.toggle("reading-compact",layout==="compact");box.setAttribute("aria-busy","false");
  ["compact","list","card"].forEach(function(name){$("source-"+name+"-view").setAttribute("aria-pressed",String(layout===(name==="card"?"cards":name)));});
  renderOrganizer();
  document.querySelectorAll("[data-library-view]").forEach(function(a){if(a.dataset.libraryView===view)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");});
  $("count-all").textContent=sources.length;$("count-inbox").textContent=sources.filter(function(s){return !s.archivedAt;}).length;
  $("count-summarized").textContent=sources.filter(function(s){return !!s.summary;}).length;$("count-archive").textContent=sources.filter(function(s){return !!s.archivedAt;}).length;
  var rows=sources.filter(function(s){return (view!=="inbox"||!s.archivedAt)&&(view!=="archive"||s.archivedAt)&&(view!=="summarized"||s.summary)&&(!space||(space==="unfiled"?!s.spaceId:s.spaceId===space))&&(!tag||s.tags.includes(tag))&&(s.title+" "+(s.url||"")+" "+s.excerpt+" "+(s.summary||"")+" "+s.tags.join(" ")).toLowerCase().includes(q);});
  var sort=$("source-sort").value;
  rows.sort(function(a,b){return sort==="title"?a.title.localeCompare(b.title):sort==="oldest"?a.createdAt.localeCompare(b.createdAt):b.createdAt.localeCompare(a.createdAt);});
  $("source-count").textContent=rows.length+" "+(rows.length===1?"link":"links")+(sources.length!==rows.length?" of "+sources.length+" saved":"");
  var pages=Math.max(1,Math.ceil(rows.length/pageSize));pageNumber=Math.min(pageNumber,pages);
  $("source-prev").disabled=pageNumber===1;$("source-next").disabled=pageNumber===pages;
  $("source-page").textContent=rows.length?((pageNumber-1)*pageSize+1)+"–"+Math.min(pageNumber*pageSize,rows.length)+" of "+rows.length:"0 articles";
  rows=rows.slice((pageNumber-1)*pageSize,pageNumber*pageSize);updateUrl();
  if(!rows.length){emptyState(box,sources.length?"No links here yet":"Keep something worth coming back to",sources.length?"Try All saved, another filter, or a different search.":"Save your first link above, or use Chrome capture to keep the page and its text.");return;}
  rows.forEach(function(s){
    var row=element("article",undefined,"library-item"),text=element("div",undefined,"library-item-content");
    var heading=element("h2");heading.append(appLink(s.title,"/library/"+encodeURIComponent(s.id)));
    var domain=host(s.url),mark=element("span",domain.charAt(0).toUpperCase(),"library-domain-mark");mark.setAttribute("aria-hidden","true");
    text.append(element("p",domain+" · "+new Date(s.createdAt).toLocaleDateString()+(s.summary?" · Summary ready":""),"library-origin"),heading);
    var preview=s.summary||s.excerpt;if(preview)text.append(element("p",preview.slice(0,200)+(preview.length>200?"…":""),"library-preview"));
    var meta=element("div",undefined,"library-labels");
    if(s.summary)meta.append(element("span","Summary ready","library-summary-label"));
    if(s.archivedAt)meta.append(element("span","Archived"));
    var collection=spaces.find(function(item){return item.id===s.spaceId;});if(collection){var folder=element("button",collection.name,"library-tag");folder.type="button";folder.onclick=function(){$("source-space-filter").value=s.spaceId;pageNumber=1;renderSources();};meta.append(folder);}
    s.tags.forEach(function(t){var chip=element("button","#"+t,"library-tag");chip.type="button";chip.onclick=function(){$("source-tag-filter").value=t;pageNumber=1;renderSources();};meta.append(chip);});
    text.append(meta);
    var actions=element("div",undefined,"library-item-actions");
    if(!s.summary){var summarize=element("button","Summarize","ghost");summarize.type="button";summarize.setAttribute("aria-label","Summarize "+s.title);summarize.onclick=function(){busy(this,async function(){
      message("Summarizing "+s.title+"...");
      var r=await api("/api/read-later/"+encodeURIComponent(s.id)+"/summarize","POST",{});sources=sources.map(function(item){return item.id===s.id?r.source:item;});renderSources();message("Summary ready.");
    });};actions.append(summarize);}
    var archive=element("button",s.archivedAt?"Read later":"Archive","ghost");archive.type="button";archive.setAttribute("aria-label",(s.archivedAt?"Move to Read later: ":"Archive ")+s.title);
    archive.onclick=function(){busy(this,async function(){var r=await api("/api/knowledge/sources/"+encodeURIComponent(s.id),"PUT",{archived:!s.archivedAt});sources=sources.map(function(item){return item.id===s.id?r.source:item;});renderSources();message(s.archivedAt?"Moved to Read later.":"Archived. Still in All saved.");});};actions.append(archive);
    var organize=element("details",undefined,"reading-organize"),toggle=element("summary","Organize");toggle.setAttribute("aria-label","Organize "+s.title);organize.append(toggle);
    var editor=element("form"),folderLabel=element("label","Folder"),select=element("select"),tagLabel=element("label","Tags"),tags=element("input"),save=element("button","Save organization","ghost");
    select.id="folder-"+s.id;folderLabel.htmlFor=select.id;spaceOptions(select,spaces,"Unfiled");select.value=s.spaceId||"";
    tags.id="tags-"+s.id;tagLabel.htmlFor=tags.id;tags.value=s.tags.join(", ");save.type="submit";editor.append(folderLabel,select,tagLabel,tags,save);
    editor.onsubmit=function(e){e.preventDefault();busy(save,async function(){var r=await api("/api/knowledge/sources/"+encodeURIComponent(s.id),"PUT",{spaceId:select.value||null,tags:tags.value.split(",").map(function(t){return t.trim();}).filter(Boolean)});sources=sources.map(function(item){return item.id===s.id?r.source:item;});refreshOptions();renderSources();message("Folder and tags saved.");});};
    organize.append(editor);actions.append(organize);
    row.append(mark,text,actions);box.append(row);
  });
}
async function loadSources(){
  var r=await api("/api/knowledge");sources=r.sources;spaces=r.spaces;
  refreshOptions();
}
function refreshOptions(){
  var oldSpace=$("source-space-filter").value,oldTag=$("source-tag-filter").value;
  spaceOptions($("source-space-filter"),spaces,"All folders");$("source-space-filter").add(new Option("Unfiled","unfiled"));
  var captureFolder=$("capture-space").value;spaceOptions($("capture-space"),spaces,"Unfiled");$("capture-space").value=captureFolder;
  $("source-tag-filter").replaceChildren(new Option("All tags",""));
  Array.from(new Set(sources.flatMap(function(s){return s.tags;}))).sort().forEach(function(t){$("source-tag-filter").add(new Option(t,t));});
  $("source-space-filter").value=oldSpace;$("source-tag-filter").value=oldTag;
  if($("source-space-filter").selectedIndex<0)$("source-space-filter").value="";
  if($("source-tag-filter").selectedIndex<0)$("source-tag-filter").value="";
}
function renderOrganizer(){
  function choice(box,label,count,value,field){
    var button=element("button",undefined,"reading-folder");button.type="button";button.append(element("span",label),element("span",String(count),"dim"));
    button.setAttribute("aria-pressed",String($(field).value===value));button.onclick=function(){$(field).value=value;pageNumber=1;renderSources();};box.append(button);
  }
  var folders=$("folder-list"),tags=$("tag-list");folders.replaceChildren();tags.replaceChildren();
  choice(folders,"All folders",sources.length,"","source-space-filter");
  choice(folders,"Unfiled",sources.filter(function(s){return !s.spaceId;}).length,"unfiled","source-space-filter");
  spaces.forEach(function(s){choice(folders,s.name,sources.filter(function(item){return item.spaceId===s.id;}).length,s.id,"source-space-filter");});
  choice(tags,"All tags",sources.length,"","source-tag-filter");
  Array.from(new Set(sources.flatMap(function(s){return s.tags;}))).sort().forEach(function(t){choice(tags,"#"+t,sources.filter(function(s){return s.tags.includes(t);}).length,t,"source-tag-filter");});
  if(!sources.some(function(s){return s.tags.length;}))tags.append(element("p","Add tags with Organize on any article.","dim"));
}
$("folder-form").onsubmit=function(e){e.preventDefault();busy(e.submitter,async function(){var r=await api("/api/knowledge/spaces","POST",{name:$("folder-name").value});spaces.push(r.space);refreshOptions();$("source-space-filter").value=r.space.id;pageNumber=1;renderSources();$("folder-form").reset();message("Folder created. It is also available in Spaces.");});};
$("source-add").onclick=function(){$("capture-panel").open=true;$("capture-space").value=$("source-space-filter").value==="unfiled"?"":$("source-space-filter").value;$("capture-tags").value=$("source-tag-filter").value;$("capture-url").focus();};
document.querySelectorAll("[data-library-view]").forEach(function(a){a.onclick=function(e){if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();view=a.dataset.libraryView;pageNumber=1;renderSources();};});
$("source-search").oninput=function(){pageNumber=1;renderSources();};
["source-space-filter","source-tag-filter","source-sort"].forEach(function(id){$(id).onchange=function(){pageNumber=1;renderSources();};});
["compact","list","card"].forEach(function(name){$("source-"+name+"-view").onclick=function(){layout=name==="card"?"cards":name;cards=layout==="cards";renderSources();};});
$("source-prev").onclick=function(){pageNumber--;renderSources();$("source-count").scrollIntoView({block:"nearest"});};
$("source-next").onclick=function(){pageNumber++;renderSources();$("source-count").scrollIntoView({block:"nearest"});};
var form=$("capture-form");
form.onsubmit=function(e){e.preventDefault();var button=e.submitter||form.querySelector("button"),summarize=button.value==="summarize";busy(button,async function(){
  var r=await api("/api/read-later","POST",{url:$("capture-url").value,title:$("capture-title").value||undefined,excerpt:$("capture-text").value,spaceId:$("capture-space").value||null,tags:$("capture-tags").value.split(",").map(function(t){return t.trim();}).filter(Boolean),summarize:summarize});
  await loadSources();pageNumber=1;view=r.source.archivedAt?"archive":"inbox";$("source-search").value="";$("source-space-filter").value="";$("source-tag-filter").value="";updateUrl();renderSources();
  message((r.duplicate?"Already saved. Use Organize to change its folder or tags.":"Link saved.")+(r.summaryError?" Summary failed: "+r.summaryError:""),!!r.summaryError);
  if(!r.summaryError){form.reset();$("capture-panel").open=false;}
});};
loadSources().then(function(){
  $("source-search").value=params.get("q")||"";$("source-space-filter").value=params.get("space")||"";$("source-tag-filter").value=params.get("tag")||"";
  $("source-sort").value=["newest","oldest","title"].includes(params.get("sort"))?params.get("sort"):"newest";renderSources();
}).catch(function(err){$("source-count").textContent="Could not load saved links.";$("source-list").setAttribute("aria-busy","false");fail(err);});`,
  });
}

export function sourceDetailPage(nav?: NavLink[]): string {
  return workspacePage({
    title: "Saved page", description: "Read, understand, and put a useful idea to work.", active: "/library", nav,
    actions: '<a class="btn ghost" href="/library">Back to Read Later</a>',
    body: `<main class="reading-column" id="source-detail" hidden><p id="source-origin" class="dim"></p><h1 id="source-title"></h1>
<div class="reading-actions"><a id="source-original" class="btn ghost" target="_blank" rel="noopener noreferrer">Open original</a><button id="source-summarize" type="button">Summarize</button><button id="source-archive" class="ghost" type="button">Archive</button></div>
<section class="reading-summary"><h2>Summary</h2><p id="source-summary" class="reading-text"></p></section>
<details id="source-text-details" class="workspace-details"><summary>Captured article text</summary><p id="source-text" class="reading-text"></p></details>
<section class="workspace-details"><h2>Put it to work</h2><div class="row"><button id="source-note" class="ghost" type="button">Create a note</button><button id="source-task-toggle" class="ghost" type="button">Create a board task</button><a id="source-ask" class="btn ghost" href="/agent?view=assistant">Ask the Assistant</a></div>
<form id="source-task-form" hidden><label for="source-task-title">Task title</label><input id="source-task-title" maxlength="200" required><button type="submit">Add to board</button></form>
<label for="source-space">Folder (Space)</label><select id="source-space"></select><button id="source-space-save" class="ghost" type="button">Save folder</button>
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
  $("source-ask").href="/agent?view=assistant&source="+encodeURIComponent(source.id);
  $("source-edit-title").value=source.title;$("source-edit-text").value=source.excerpt;$("source-tags").value=source.tags.join(", ");
}
async function updateSource(body){var r=await api("/api/knowledge/sources/"+encodeURIComponent(id),"PUT",body);source=r.source;renderSource();}
$("source-summarize").onclick=function(){busy(this,async function(){message("Summarizing…");var r=await api("/api/read-later/"+encodeURIComponent(id)+"/summarize","POST",{});source=r.source;renderSource();message("Summary ready.");});};
$("source-archive").onclick=function(){busy(this,async function(){await updateSource({archived:!source.archivedAt});message(source.archivedAt?"Archived. Still in All saved and its space.":"Moved to Read later.");});};
$("source-space-save").onclick=function(){var selected=$("source-space").value;busy(this,async function(){await updateSource({spaceId:selected||null});message("Folder updated.");});};
$("source-note").onclick=function(){busy(this,async function(){var r=await api("/api/knowledge/notes","POST",{title:source.title,content:source.summary||source.excerpt,sourceUrl:source.url,tags:source.tags,spaceId:source.spaceId});var box=$("source-result");box.replaceChildren(appLink("Note created. Open it →","/notes?note="+encodeURIComponent(r.note.id)));});};
$("source-task-toggle").onclick=function(){$("source-task-form").hidden=!$("source-task-form").hidden;$("source-task-title").value=source.title;$("source-task-title").focus();};
$("source-task-form").onsubmit=function(e){e.preventDefault();busy(e.submitter,async function(){await api("/api/board/cards","POST",{title:$("source-task-title").value,notes:((source.url||"")+"\\n\\n"+(source.summary||source.excerpt)).slice(0,8000)});$("source-task-form").hidden=true;$("source-result").replaceChildren(appLink("Task created. Open board →","/agent?view=board"));});};
$("source-edit-form").onsubmit=function(e){e.preventDefault();busy(e.submitter,async function(){await updateSource({title:$("source-edit-title").value,excerpt:$("source-edit-text").value,tags:$("source-tags").value.split(",").map(function(t){return t.trim();}).filter(Boolean)});message("Changes saved.");});};
api("/api/knowledge").then(function(data){source=data.sources.find(function(s){return s.id===id;});spaces=data.spaces;if(!source)throw new Error("Saved page not found. Return to Read Later.");renderSource();}).catch(fail);
`,
  });
}
