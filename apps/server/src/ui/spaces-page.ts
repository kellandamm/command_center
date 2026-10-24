import type { NavLink } from "./layout";
import { button, field } from "./components";
import { workspacePage } from "./workspace";

export function spacesPage(nav?: NavLink[]): string {
  return workspacePage({
    title: "Spaces",
    description: "Group notes, saved pages, tasks and events around a project, then ask questions across them.",
    active: "/spaces",
    nav,
    body: `<form id="space-form" class="workspace-inline-form">
${field({ label: "New space", id: "space-name", inputHtml: '<input id="space-name" required maxlength="120" placeholder="Name a project or topic">' })}
${field({
  label: "Guidance for the assistant",
  id: "space-instructions",
  inputHtml:
    '<textarea id="space-instructions" maxlength="2000" placeholder="Optional. For example: keep answers short and practical."></textarea>',
})}
<button type="submit">Create space</button></form>
<div id="space-list" class="workspace-list"></div>`,
    script: `
var data={spaces:[],notes:[],sources:[]};
function renderSpaces(){
  var box=$("space-list");box.replaceChildren();
  if(!data.spaces.length){emptyState(box,"No spaces yet","Create one to gather related notes and saved pages in a single place.");return;}
  data.spaces.forEach(function(s){
    var notes=data.notes.filter(function(n){return n.spaceId===s.id;}).length,saved=data.sources.filter(function(n){return n.spaceId===s.id;}).length;
    var row=element("a",undefined,"workspace-item");row.href="/spaces/"+encodeURIComponent(s.id);
    var text=element("div");text.append(element("div",s.name,"workspace-item-title"),element("p",notes+" notes · "+saved+" saved pages · "+s.references.length+" linked items"));
    if(s.instructions)text.append(element("p",s.instructions.slice(0,160)));
    row.append(text);box.append(row);
  });
}
$("space-form").onsubmit=function(e){e.preventDefault();busy(e.submitter,async function(){
  var r=await api("/api/knowledge/spaces","POST",{name:$("space-name").value,instructions:$("space-instructions").value});
  location.href="/spaces/"+encodeURIComponent(r.space.id);
});};
api("/api/knowledge").then(function(d){data=d;renderSpaces();}).catch(function(err){errorState($("space-list"),err.message||"Could not load spaces.");fail(err);});`,
  });
}

export function spaceDetailPage(nav?: NavLink[]): string {
  return workspacePage({
    title: "Space",
    description: "Everything gathered for one project or topic.",
    active: "/spaces",
    nav,
    actions: button({ label: "All spaces", variant: "ghost", href: "/spaces" }),
    body: `<main id="space-detail" hidden><div class="reading-actions"><a id="space-ask" class="btn" href="#">Ask this space</a><a id="space-new-note" class="btn ghost" href="#">New note here</a></div>
<p id="space-guidance" class="dim"></p>
<h2>Notes</h2><div id="space-notes" class="workspace-list"></div>
<h2>Saved pages</h2><div id="space-sources" class="workspace-list"></div>
<h2>Linked tasks and events</h2><div id="space-refs" class="workspace-list"></div>
<details class="workspace-details"><summary>Link a board card or calendar event</summary><form id="ref-form" class="workspace-inline-form">
${field({ label: "Type", id: "ref-type", inputHtml: '<select id="ref-type"><option value="board">Board card</option><option value="calendar">Calendar event</option></select>' })}
${field({ label: "Item id", id: "ref-id", inputHtml: '<input id="ref-id" required maxlength="200">' })}
<button type="submit">Link item</button></form></details></main>`,
    script: `
var spaceId=decodeURIComponent(location.pathname.split("/")[2]||""),data=null,space=null;
function fill(box,rows,empty,href){box.replaceChildren();if(!rows.length){emptyState(box,empty,"");return;}
  rows.forEach(function(r){var row=element("a",undefined,"workspace-item");row.href=href(r);row.append(element("div",r.title,"workspace-item-title"));box.append(row);});}
function renderSpace(){
  $("space-detail").hidden=false;document.querySelector(".workspace-head h1").textContent=space.name;
  $("space-guidance").textContent=space.instructions?"Guidance: "+space.instructions:"";
  $("space-ask").href="/agent?view=assistant&space="+encodeURIComponent(space.id);$("space-new-note").href="/notes?space="+encodeURIComponent(space.id);
  fill($("space-notes"),data.notes.filter(function(n){return n.spaceId===space.id;}),"No notes in this space yet.",function(n){return "/notes?note="+encodeURIComponent(n.id);});
  fill($("space-sources"),data.sources.filter(function(n){return n.spaceId===space.id;}),"No saved pages in this space yet.",function(n){return "/library/"+encodeURIComponent(n.id);});
  fill($("space-refs"),space.references,"Nothing linked yet.",function(r){return r.href;});
}
$("ref-form").onsubmit=function(e){e.preventDefault();busy(e.submitter,async function(){
  await api("/api/knowledge/space-references","POST",{spaceId:space.id,type:$("ref-type").value,targetId:$("ref-id").value});
  data=await api("/api/knowledge");space=data.spaces.find(function(s){return s.id===spaceId;});renderSpace();message("Item linked.");$("ref-form").reset();
});};
api("/api/knowledge").then(function(d){data=d;space=d.spaces.find(function(s){return s.id===spaceId;});if(!space)throw new Error("Space not found.");renderSpace();}).catch(fail);`,
  });
}
