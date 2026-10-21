import type { NavLink } from "./layout";
import { workspacePage, workspaceTabs } from "./workspace";

const tabs = (active: string) => workspaceTabs([
  ["/notes", "My notes"], ["/notes/connections", "Connections"], ["/notes/transfer", "Import & export"],
], active);

export function notesPage(nav?: NavLink[]): string {
  return workspacePage({
    title: "Notes", description: "A place to think, write, and connect ideas.", active: "/notes", nav, tabs: tabs("/notes"),
    actions: '<button id="new-note" type="button">New note</button>',
    body: `<div class="workspace-editor"><aside aria-label="Your notes">
<label for="note-search">Find a note</label><input id="note-search" type="search" placeholder="Search notes">
<div id="knowledge-note-list"></div></aside>
<main class="note-document"><div id="note-empty" class="workspace-empty"><h2>Start with a thought</h2><p>Create a note or choose one from the list. Everything else can wait.</p></div>
<form id="note-form" hidden><label for="note-title">Title</label><input class="note-title" id="note-title" maxlength="240" required placeholder="Untitled note">
<label for="note-body">Your note · Markdown supported</label><textarea id="note-body" placeholder="Write here. Link another note with [[its title]]."></textarea>
<div class="row"><button type="submit">Save note</button><span id="note-save-status" role="status"></span></div>
<details class="workspace-details"><summary>Note details</summary><div class="row">
<div><label for="note-space">Space</label><select id="note-space"></select></div>
<div><label for="note-tags">Tags</label><input id="note-tags" placeholder="Comma-separated"></div></div>
<label for="note-url">Source URL</label><input id="note-url" type="url">
<button class="ghost" id="note-delete" type="button">Delete note</button></details>
<div id="note-backlinks" class="workspace-details"></div></form></main></div>`,
    script: `
var data={notes:[],spaces:[]},current=null,dirty=false;
function canLeave(){return !dirty||confirm("Discard unsaved changes to this note?");}
function renderList(){
  var box=$("knowledge-note-list"),q=$("note-search").value.toLowerCase();box.replaceChildren();
  var notes=data.notes.filter(function(n){return (n.title+" "+n.content+" "+n.tags.join(" ")).toLowerCase().includes(q);});
  if(!notes.length){box.append(element("p",q?"No matching notes.":"No notes yet.","dim"));return;}
  notes.forEach(function(n){var b=element("button",n.title,"ghost note-pick");b.type="button";b.setAttribute("aria-current",String(current&&current.id===n.id));b.onclick=function(){if(canLeave())openNote(n);};box.append(b);});
}
function openNote(note){
  current=note;dirty=false;$("note-empty").hidden=true;$("note-form").hidden=false;
  $("note-title").value=note.title;$("note-body").value=note.content;$("note-tags").value=note.tags.join(", ");$("note-space").value=note.spaceId||"";$("note-url").value=note.sourceUrl||"";
  $("note-save-status").textContent="";$("note-delete").hidden=!note.id;renderList();
  var box=$("note-backlinks");box.replaceChildren(element("h2","Linked from"));
  var linked=data.notes.filter(function(n){return n.id!==note.id&&Array.from(n.content.matchAll(/\\[\\[([^\\]]+)\\]\\]/g)).some(function(m){return m[1].trim().toLowerCase()===note.title.trim().toLowerCase();});});
  if(!linked.length)box.append(element("p","No backlinks yet.","dim"));
  linked.forEach(function(n){box.append(appLink(n.title,"/notes?note="+encodeURIComponent(n.id),"btn ghost"));});
  history.replaceState(null,"",note.id?"/notes?note="+encodeURIComponent(note.id):"/notes");
}
async function loadNotes(selected){
  data=await api("/api/knowledge");spaceOptions($("note-space"),data.spaces);renderList();
  var id=selected||new URLSearchParams(location.search).get("note");var note=data.notes.find(function(n){return n.id===id;});
  if(note)openNote(note);else if(!current&&data.notes.length)openNote(data.notes[0]);
}
$("note-search").oninput=renderList;
$("new-note").onclick=function(){if(canLeave()){openNote({id:null,title:"",content:"",tags:[],spaceId:new URLSearchParams(location.search).get("space")||null});$("note-title").focus();}};
$("note-form").oninput=function(){dirty=true;$("note-save-status").textContent="Unsaved changes";};
$("note-form").onsubmit=function(e){e.preventDefault();busy(e.submitter,async function(){
  $("note-save-status").textContent="Saving…";
  var result=await api(current.id?"/api/knowledge/notes/"+encodeURIComponent(current.id):"/api/knowledge/notes",current.id?"PUT":"POST",{title:$("note-title").value,content:$("note-body").value,tags:$("note-tags").value.split(",").map(function(t){return t.trim();}).filter(Boolean),spaceId:$("note-space").value||null,sourceUrl:$("note-url").value||null});
  dirty=false;await loadNotes(result.note.id);$("note-save-status").textContent="Saved";
});};
$("note-delete").onclick=function(){if(current&&current.id&&confirm("Delete this note?"))busy(this,async function(){await api("/api/knowledge/notes/"+encodeURIComponent(current.id),"DELETE");current=null;dirty=false;$("note-form").hidden=true;$("note-empty").hidden=false;history.replaceState(null,"","/notes");await loadNotes();message("Note deleted.");});};
window.addEventListener("beforeunload",function(e){if(dirty){e.preventDefault();e.returnValue="";}});
loadNotes().catch(fail);
`,
  });
}

export function noteToolsPage(nav: NavLink[] | undefined, connections: boolean): string {
  return workspacePage({
    title: connections ? "Connections" : "Import & export",
    description: connections ? "Follow the links between your notes." : "Your material stays yours. Transfer Markdown or back up the complete workspace.",
    active: "/notes", nav, tabs: tabs(connections ? "/notes/connections" : "/notes/transfer"),
    body: connections ? '<p class="dim">Connect notes by writing [[Note title]] in the note body.</p><div id="note-connections" class="workspace-list"></div>' :
      `<div class="workspace-form"><h2>Export</h2><div class="row"><a class="btn ghost" href="/api/knowledge/export.md">Export Markdown</a><a class="btn ghost" href="/api/knowledge/export.json">Download full backup</a></div>
<p class="dim">The JSON backup includes notes, sources, summaries, archive status, and spaces.</p>
<div class="workspace-details"><h2>Import</h2><label for="transfer-file">Markdown note or JSON backup</label><input id="transfer-file" type="file" accept=".md,.json"><button id="transfer-import" type="button">Import file</button><p class="dim">Backups merge without overwriting existing records.</p></div></div>`,
    script: connections ? `
api("/api/knowledge/graph").then(function(graph){
  var box=$("note-connections");
  if(!graph.edges.length){emptyState(box,"No connections yet","Add a [[link]] to another note, then come back here.");return;}
  graph.edges.forEach(function(edge){var a=graph.nodes.find(function(n){return n.id===edge.from;}),b=graph.nodes.find(function(n){return n.id===edge.to;});if(!a||!b)return;var row=element("div",undefined,"workspace-item");row.append(appLink(a.title,"/notes?note="+encodeURIComponent(a.id)),element("span","links to","dim"),appLink(b.title,"/notes?note="+encodeURIComponent(b.id)));box.append(row);});
}).catch(fail);` : `
$("transfer-import").onclick=function(){busy(this,async function(){
  var file=$("transfer-file").files[0];if(!file)throw new Error("Choose a Markdown file or JSON backup first.");
  var text=await file.text();
  if(/\\.json$/i.test(file.name)){var result=await api("/api/knowledge/import.json","POST",JSON.parse(text));message("Imported "+result.notes+" notes, "+result.sources+" sources, and "+result.spaces+" spaces. "+result.skipped+" duplicates skipped.");}
  else {await api("/api/knowledge/import","POST",{title:file.name.replace(/\\.md$/i,""),markdown:text});message("Note imported. Find it in My notes.");}
});};`,
  });
}
