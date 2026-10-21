import type { NavLink } from "./layout";
import { page } from "./layout";
import { workspacePage, workspaceTabs } from "./workspace";

const tabs = (active: string) => workspaceTabs([
  ["/notes", "My notes"], ["/notes/connections", "Connections"], ["/notes/transfer", "Import & export"],
], active);

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

export function notesPage(nav?: NavLink[]): string {
  return page({
    title: "Notes — Command center",
    active: "/notes",
    nav,
    body: `<header class="page-header notes-header"><div><h1>Notes</h1><p class="dim">A quiet place to think, write, and connect ideas.</p></div>
<div class="row">
  <button id="knowledge-new-note" type="button" disabled>New note</button>
  <button id="knowledge-focus" class="ghost" type="button" aria-pressed="false" title="Focus mode (Ctrl/Cmd + Shift + F)">Focus mode</button>
</div>
</header>${tabs("/notes")}
<div class="notes-workspace">
  <aside class="notes-library" aria-label="Note library">
    <label for="knowledge-search">Search notes &amp; links</label>
    <input id="knowledge-search" type="search" placeholder="Find an idea…">
    <div class="notes-library-heading"><h2>Library</h2><span id="knowledge-note-count" class="dim"></span></div>
    <button id="knowledge-all-notes" class="ghost notes-all" type="button">All notes</button>
    <div id="knowledge-note-list" aria-label="Notes"></div>
    <details class="notes-library-section">
      <summary>Spaces</summary>
      <div id="knowledge-spaces" class="row"></div>
      <button id="knowledge-new-space" class="ghost" type="button">New space</button>
      <h2 style="margin-top:1.25rem">Space references</h2><div id="knowledge-space-references" class="dim"></div>
    <details style="margin-top:.75rem">
      <summary style="cursor:pointer;font-weight:600">Link a Board or Calendar item</summary>
      <label for="knowledge-record-kind">Item type</label><select id="knowledge-record-kind"><option value="board">Board card</option><option value="calendar">Calendar event</option></select>
      <button id="knowledge-load-records" class="ghost" type="button" style="margin-top:.5rem">Load items</button>
      <label for="knowledge-record-select">Item</label><select id="knowledge-record-select"><option value="">Load items first</option></select>
      <button id="knowledge-add-record" type="button" style="margin-top:.5rem">Link to selected space</button>
    </details>
    </details>
    <details class="notes-library-section">
    <summary>Captured links</summary><div id="knowledge-source-list"></div>
    <details style="margin-top:1rem">
      <summary style="cursor:pointer;font-weight:600">Capture a link</summary>
      <form id="knowledge-source-form">
        <label for="knowledge-source-title">Title</label><input id="knowledge-source-title" maxlength="240" required>
        <label for="knowledge-source-url">URL</label><input id="knowledge-source-url" type="url" placeholder="https://" required>
        <label for="knowledge-source-excerpt">Excerpt or notes</label><textarea id="knowledge-source-excerpt" maxlength="20000"></textarea>
        <label for="knowledge-source-tags">Tags (comma-separated)</label><input id="knowledge-source-tags" placeholder="research, ideas">
        <button style="margin-top:.75rem" type="submit">Save link</button>
      </form>
    </details>
    </details>
    <details class="notes-library-section">
      <summary>Import &amp; export</summary>
      <div class="notes-file-actions">
        <a class="btn ghost" href="/api/knowledge/export.md">Export Markdown</a>
        <a class="btn ghost" href="/api/knowledge/export.json">Download backup</a>
        <label class="btn ghost" style="margin:0;cursor:pointer">Import file<input id="knowledge-import-file" type="file" accept=".md,.json,text/markdown,application/json" hidden></label>
      </div>
    </details>
  </aside>
  <div class="notes-main">
    <section id="knowledge-editor" class="notes-editor" aria-label="Note editor">
      <div class="notes-editor-bar">
        <h2 id="knowledge-editor-heading">Start with an idea</h2>
        <div class="notes-modes" role="group" aria-label="Editor view">
          <button class="ghost" type="button" data-note-mode="source" aria-pressed="false" title="Source (Ctrl/Cmd + 1)">Source</button>
          <button class="ghost" type="button" data-note-mode="split" aria-pressed="true" title="Split (Ctrl/Cmd + 2)">Split</button>
          <button class="ghost" type="button" data-note-mode="preview" aria-pressed="false" title="Preview (Ctrl/Cmd + 3)">Preview</button>
        </div>
      </div>
      <fieldset id="knowledge-fields" class="notes-document" disabled>
      <label class="notes-sr-only" for="knowledge-title">Title</label><input id="knowledge-title" class="notes-title" maxlength="240" placeholder="Untitled note">
      <details class="notes-properties">
      <summary>Note properties <span class="dim">Tags, space, source</span></summary>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:.75rem">
        <div><label for="knowledge-tags">Tags (comma-separated)</label><input id="knowledge-tags" placeholder="research, ideas"></div>
        <div><label for="knowledge-space-select">Space</label><select id="knowledge-space-select"><option value="">No space</option></select></div>
        <div><label for="knowledge-note-url">Source URL (optional)</label><input id="knowledge-note-url" type="url"></div>
      </div>
      </details>
      <div id="knowledge-formatting" class="notes-formatting" role="toolbar" aria-label="Markdown formatting">
        <button class="ghost" type="button" data-note-format="heading" title="Heading">H2</button>
        <button class="ghost" type="button" data-note-format="bold" title="Bold (Ctrl/Cmd + B)"><strong>B</strong></button>
        <button class="ghost" type="button" data-note-format="italic" title="Italic (Ctrl/Cmd + I)"><em>I</em></button>
        <button class="ghost" type="button" data-note-format="bullet">List</button>
        <button class="ghost" type="button" data-note-format="task">Task</button>
        <button class="ghost" type="button" data-note-format="quote">Quote</button>
        <button class="ghost" type="button" data-note-format="link">Link</button>
        <button class="ghost" type="button" data-note-format="code">Code</button>
      </div>
      <div id="knowledge-writing" class="notes-writing" data-mode="split">
        <div class="notes-source"><label class="notes-sr-only" for="knowledge-body">Markdown</label><textarea id="knowledge-body" spellcheck="true" placeholder="Write something worth keeping…&#10;&#10;Markdown supported. Select text to format it."></textarea></div>
        <div class="notes-preview-pane"><div class="notes-pane-label dim">Live preview</div><div id="knowledge-preview" class="notes-preview" role="region" aria-label="Markdown preview"></div><p id="knowledge-preview-status" class="dim" role="status"></p></div>
      </div>
      <div class="notes-editor-footer">
        <span id="knowledge-save-status" class="dim" role="status">Changes save automatically</span>
        <span id="knowledge-word-count" class="dim">0 words</span>
        <button id="knowledge-save-note" type="button">Save note</button>
        <button id="knowledge-delete-note" class="ghost" type="button" disabled>Delete note</button>
      </div>
      <div id="knowledge-backlinks" class="dim" style="margin-top:1rem"></div>
      </fieldset>
    </section>
    <details class="card notes-secondary" style="margin-top:1rem">
      <summary>Ask this space</summary>
      <p class="dim">Questions use only notes and captured sources assigned to the selected space. Content is sent to the configured LLM only when you ask, with a limit of 10 questions per hour.</p>
      <label for="knowledge-ask-space">Space</label><select id="knowledge-ask-space"><option value="">Choose a space</option></select>
      <label for="knowledge-question">Question</label><textarea id="knowledge-question" style="min-height:5rem" placeholder="What do my sources say about…"></textarea>
      <button id="knowledge-ask" type="button" style="margin-top:.75rem">Ask with sources</button>
      <div id="knowledge-answer" style="white-space:pre-wrap;margin-top:1rem"></div>
      <div id="knowledge-citations" class="row"></div>
    </details>
    <details class="card notes-secondary" style="margin-top:1rem">
      <summary style="cursor:pointer;font-weight:600">Note link graph</summary>
      <p class="dim">Add links in Markdown using <code>[[Note title]]</code>. Click a note node to open it.</p>
      <div id="knowledge-graph" style="overflow:auto"></div>
    </details>
    <div id="knowledge-status" class="dim" aria-live="polite" style="margin-top:.75rem"></div>
  </div>
</div>
<style>
.notes-header{display:flex;justify-content:space-between;gap:1rem;align-items:center}
.notes-workspace{display:grid;grid-template-columns:16rem minmax(0,1fr);min-height:70vh;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);overflow:hidden}
.notes-library{padding:1rem;background:var(--sidebar);border-right:1px solid var(--border);min-width:0}
.notes-library>label{margin-top:0}.notes-library-heading{display:flex;justify-content:space-between;align-items:center;margin:1.5rem 0 .5rem}.notes-library-heading h2{margin:0}
.notes-all{width:100%;justify-content:flex-start;margin-bottom:.5rem}
.notes-note{display:block;width:100%;text-align:left;background:transparent;color:var(--foreground);border:1px solid transparent;padding:.75rem;margin:.2rem 0}
.notes-note:hover,.notes-note[aria-current=true]{background:var(--accent);border-color:var(--border)}
.notes-note strong,.notes-note span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.notes-note span{font-size:.75rem;font-weight:400;margin-top:.2rem;color:var(--dim)}
#knowledge-note-list{max-height:42vh;overflow:auto}.notes-library-section{padding:.85rem 0;border-top:1px solid var(--border);margin-top:.5rem}
.notes-library summary,.notes-secondary>summary,.notes-properties>summary{cursor:pointer;font-weight:500}
.notes-file-actions{display:grid;gap:.5rem;margin-top:.75rem}.notes-main{min-width:0;padding:0 1.25rem 1.25rem}
.notes-editor-bar{display:flex;align-items:center;justify-content:space-between;gap:.75rem;border-bottom:1px solid var(--border);padding:.75rem 0;flex-wrap:wrap}
.notes-editor-bar h2{margin:0;color:var(--dim);font-weight:400;overflow-wrap:anywhere}
.notes-modes{display:flex;gap:.2rem}.notes-modes button{font-size:.75rem;padding:.3rem .6rem;min-height:2rem}
.notes-modes button[aria-pressed=true]{background:var(--primary);color:var(--primary-foreground)}
.notes-document{padding:1.5rem 0 .5rem;max-width:80rem;min-width:0;width:100%;margin:auto;border:0}
input.notes-title{font-size:1.9rem;letter-spacing:-.035em;font-weight:600;border:0;box-shadow:none;padding:.25rem 0;background:transparent;border-radius:0}
.notes-properties{padding:.75rem 0;margin-bottom:.75rem}.notes-properties summary{font-size:.8rem;color:var(--dim)}.notes-properties summary span{font-weight:400;margin-left:.5rem}
.notes-formatting{display:flex;gap:.25rem;flex-wrap:wrap;border-top:1px solid var(--border);padding:.65rem 0}
.notes-formatting button{min-height:1.9rem;padding:.25rem .6rem;font-size:.75rem}
.notes-formatting[hidden]{display:none}
.notes-writing{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:27rem}
.notes-source{min-width:0}.notes-source textarea{width:100%;min-height:27rem;height:100%;resize:vertical;border:0;box-shadow:none;padding:1rem .75rem 1rem 0;line-height:1.8;font-size:.875rem;background:transparent}
.notes-preview-pane{border-left:1px solid var(--border);padding:1rem 0 1rem 1.25rem;min-width:0;overflow-wrap:anywhere}
.notes-pane-label{font-size:.65rem;text-transform:uppercase;letter-spacing:.12em;margin-bottom:1.25rem}
.notes-preview{font-size:.95rem;line-height:1.8}.notes-preview>:first-child{margin-top:0}.notes-preview h1{font-size:1.8rem}.notes-preview h2{font-size:1.4rem;line-height:1.35;margin:1.5rem 0 .75rem}.notes-preview h3{font-size:1.1rem}
.notes-preview a{color:var(--foreground);text-decoration:underline}.notes-preview pre{padding:1rem;background:var(--muted);border-radius:var(--radius);overflow:auto}.notes-preview pre code{padding:0}
.notes-preview blockquote{margin:1rem 0;padding:.1rem 1rem;border-left:3px solid var(--border);color:var(--dim)}
.notes-preview table{border-collapse:collapse;display:block;overflow:auto}.notes-preview th,.notes-preview td{padding:.4rem .7rem;border:1px solid var(--border)}
.notes-preview input{margin-right:.4rem}.notes-preview hr{border:0;border-top:1px solid var(--border);margin:1.5rem 0}
.notes-writing[data-mode=source],.notes-writing[data-mode=preview]{grid-template-columns:minmax(0,1fr)}
.notes-writing[data-mode=source] .notes-preview-pane,.notes-writing[data-mode=preview] .notes-source{display:none}
.notes-writing[data-mode=preview] .notes-preview-pane{border:0;padding-left:0}
.notes-editor-footer{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:.75rem;font-size:.75rem}
#knowledge-word-count{margin-left:auto}.notes-editor-footer button{font-size:.75rem;min-height:1.8rem;padding:.25rem .6rem}
.notes-secondary{box-shadow:none;padding:.85rem}.notes-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
body.notes-focus .sidebar,body.notes-focus .notes-library,body.notes-focus .notes-secondary{display:none}
body.notes-focus .notes-workspace{grid-template-columns:minmax(0,1fr)}body.notes-focus .page-content{max-width:76rem}
@media(max-width:1100px){.notes-workspace{grid-template-columns:13rem minmax(0,1fr)}.notes-writing[data-mode=split]{grid-template-columns:minmax(0,1fr)}.notes-writing[data-mode=split] .notes-preview-pane{border-left:0;border-top:1px solid var(--border);padding-left:0}}
@media(max-width:700px){.notes-header{align-items:flex-start;flex-direction:column}.notes-workspace{grid-template-columns:minmax(0,1fr)}.notes-library{border-right:0;border-bottom:1px solid var(--border)}#knowledge-note-list{max-height:12rem}.notes-main{padding:0 1rem 1rem}.notes-source textarea{min-height:20rem}input.notes-title{font-size:1.6rem}}
</style>`,
    script: `
(function(){
  var state={notes:[],sources:[],spaces:[],current:null,spaceFilter:null,query:"",recordOptions:null,dirty:false,revision:0};
  var saveTimer,previewTimer,savePromise=null,previewRevision=0,loading=true,transitioning=false;
  var $=function(id){return document.getElementById(id);};
  var status=$("knowledge-status");
  function apiCall(path,method,body){
    return api(path,method||"GET",body);
  }
  function node(tag,cls,text){
    var el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!==undefined)el.textContent=text;
    return el;
  }
  function safeUrl(raw){
    try{var u=new URL(raw);return u.protocol==="http:"||u.protocol==="https:"?u.href:null;}catch(_){return null;}
  }
  function tagsFrom(input){return input.split(",").map(function(t){return t.trim().replace(/^#/,"").toLowerCase();}).filter(Boolean);}
  function addRow(container,title,detail,onClick,action){
    var row=node("div","feed-item");
    var button=node("button","ghost",title);button.type="button";button.style.width="100%";button.style.justifyContent="flex-start";button.onclick=onClick;
    row.appendChild(button);
    if(detail){var p=node("div","dim",detail);p.style.fontSize=".8rem";row.appendChild(p);}
    if(action)row.appendChild(action);
    container.appendChild(row);
  }
  function renderSpaces(){
    var list=$("knowledge-spaces"), noteSelect=$("knowledge-space-select"), askSelect=$("knowledge-ask-space");
    var selectedNoteSpace=noteSelect.value,selectedAskSpace=askSelect.value;
    list.replaceChildren();noteSelect.replaceChildren(new Option("No space",""));askSelect.replaceChildren(new Option("Choose a space",""));
    state.spaces.forEach(function(space){
      var chip=node("button","tag-chip",space.name);chip.type="button";
      chip.title=space.description||space.instructions||"";
      if(state.spaceFilter===space.id)chip.classList.add("on");
      chip.onclick=function(){state.spaceFilter=state.spaceFilter===space.id?null:space.id;render();};
      var controls=node("div","row");controls.style.margin=".25rem 0";controls.appendChild(chip);
      var edit=node("button","ghost","Edit");edit.type="button";edit.onclick=function(){
        var name=prompt("Space name",space.name);if(!name||!name.trim())return;
        var description=prompt("Description",space.description||"");if(description===null)return;
        var instructions=prompt("AI instructions",space.instructions||"");if(instructions===null)return;
        apiCall("/api/knowledge/spaces/"+encodeURIComponent(space.id),"PUT",{name:name.trim(),description:description,instructions:instructions}).then(load).catch(showError);
      };controls.appendChild(edit);
      var remove=node("button","ghost","Delete");remove.type="button";remove.onclick=function(){
        if(!confirm("Delete this space? Its notes and links will be kept but unassigned."))return;
        apiCall("/api/knowledge/spaces/"+encodeURIComponent(space.id),"DELETE").then(function(){if(state.spaceFilter===space.id)state.spaceFilter=null;return load();}).catch(showError);
      };controls.appendChild(remove);list.appendChild(controls);
      noteSelect.add(new Option(space.name,space.id));askSelect.add(new Option(space.name,space.id));
    });
    noteSelect.value=selectedNoteSpace;
    askSelect.value=selectedAskSpace;
  }
  function matchesQuery(text){return !state.query||String(text||"").toLowerCase().includes(state.query);}
  function render(){
    var noteList=$("knowledge-note-list"),sourceList=$("knowledge-source-list");
    noteList.replaceChildren();sourceList.replaceChildren();
    var visibleNotes=state.notes.filter(function(note){return (!state.spaceFilter||note.spaceId===state.spaceFilter)&&matchesQuery(note.title+"\\n"+note.content+"\\n"+(note.tags||[]).join(" "));}).sort(function(a,b){return b.updatedAt.localeCompare(a.updatedAt);});
    $("knowledge-note-count").textContent=visibleNotes.length;
    $("knowledge-all-notes").setAttribute("aria-pressed",String(!state.spaceFilter));
    visibleNotes.forEach(function(note){
      var button=node("button","notes-note");button.type="button";button.setAttribute("aria-current",String(!!state.current&&state.current.id===note.id));
      button.appendChild(node("strong","",note.title));
      button.appendChild(node("span","",note.content.replace(/[#*_\\x60>]/g,"").trim().slice(0,90)||"Empty note"));
      button.appendChild(node("span","",new Date(note.updatedAt).toLocaleDateString(undefined,{month:"short",day:"numeric"})+((note.tags||[]).length?" · "+note.tags.map(function(t){return "#"+t;}).join(" "):"")));
      button.onclick=function(){selectNote(note.id).catch(showError);};noteList.appendChild(button);
    });
    if(!visibleNotes.length)noteList.appendChild(node("p","dim",state.query||state.spaceFilter?"No matching notes.":"No notes yet. Create your first note."));
    state.sources.filter(function(source){return (!state.spaceFilter||source.spaceId===state.spaceFilter)&&matchesQuery(source.title+"\\n"+source.url+"\\n"+source.excerpt+"\\n"+(source.tags||[]).join(" "));}).forEach(function(source){
      var action=node("button","ghost","Remove");action.type="button";action.onclick=function(){
        if(!confirm("Remove this captured link?"))return;
        apiCall("/api/knowledge/sources/"+encodeURIComponent(source.id),"DELETE").then(load).catch(showError);
      };
      addRow(sourceList,source.title,source.url||source.excerpt.slice(0,120),function(){},action);
      var link=safeUrl(source.url);
      if(link){var a=node("a","dim","Open source");a.href=link;a.target="_blank";a.rel="noopener noreferrer";sourceList.lastChild.appendChild(a);}
    });
    renderSpaces();
    renderSpaceReferences();
  }
  function selectedSpaceId(){return state.spaceFilter||(state.current&&$("knowledge-space-select").value)||"";}
  function renderSpaceReferences(){
    var box=$("knowledge-space-references");box.replaceChildren();
    var space=state.spaces.find(function(item){return item.id===selectedSpaceId();});
    if(!space){box.textContent="Choose a space to view or link its Board and Calendar items.";return;}
    if(!space.references||!space.references.length){box.textContent="No linked Board or Calendar items.";return;}
    space.references.forEach(function(reference){
      var row=node("div","feed-item"),link=node("a","",reference.title);link.href=reference.href;row.appendChild(link);
      var kind=node("div","dim",reference.type);row.appendChild(kind);
      var remove=node("button","ghost","Remove");remove.type="button";remove.onclick=function(){
        apiCall("/api/knowledge/space-references","DELETE",{spaceId:space.id,referenceId:reference.id}).then(load).catch(showError);
      };row.appendChild(remove);box.appendChild(row);
    });
  }
  function load(){
    return apiCall("/api/knowledge").then(function(data){
      state.notes=data.notes||[];state.sources=data.sources||[];state.spaces=data.spaces||[];
      render();
      if(loading){loading=false;openNote(state.notes[0]||null);render();$("knowledge-fields").disabled=false;$("knowledge-new-note").disabled=false;}
    });
  }
  function transition(action){
    if(loading||transitioning)return Promise.resolve();
    transitioning=true;$("knowledge-fields").disabled=true;$("knowledge-new-note").disabled=true;
    return action().finally(function(){transitioning=false;$("knowledge-fields").disabled=false;$("knowledge-new-note").disabled=false;});
  }
  function selectNote(id){
    return transition(function(){return saveNote().then(function(){
      openNote(id?state.notes.find(function(n){return n.id===id;})||null:null);
      render();renderGraph();
    });});
  }
  function openNote(note){
    clearTimeout(saveTimer);state.current=note;state.dirty=false;state.revision++;
    $("knowledge-title").value=state.current?state.current.title:"";
    $("knowledge-body").value=state.current?state.current.content:"";
    $("knowledge-tags").value=state.current?(state.current.tags||[]).join(", "):"";
    $("knowledge-space-select").value=state.current?(state.current.spaceId||""):"";
    $("knowledge-note-url").value=state.current?(state.current.sourceUrl||""):"";
    $("knowledge-editor-heading").textContent=state.current?state.current.title:"Start with an idea";
    $("knowledge-delete-note").disabled=!state.current;
    $("knowledge-save-status").textContent=state.current?"Saved to your library":"Changes save automatically";
    renderBacklinks();
    renderSpaceReferences();
    updateWriting();
  }
  function renderBacklinks(){
    var el=$("knowledge-backlinks");el.replaceChildren();
    if(!state.current)return;
    var title=state.current.title.toLowerCase();
    var linked=state.notes.filter(function(note){return note.id!==state.current.id&&Array.from(note.content.matchAll(/\\[\\[([^\\]]+)\\]\\]/g)).some(function(match){return match[1].trim().toLowerCase()===title;});});
    var heading=node("strong","","Backlinks: ");el.appendChild(heading);
    if(!linked.length){el.appendChild(document.createTextNode("None yet"));return;}
    linked.forEach(function(note,index){
      if(index)el.appendChild(document.createTextNode(", "));
      var b=node("button","ghost",note.title);b.type="button";b.onclick=function(){selectNote(note.id).catch(showError);};el.appendChild(b);
    });
  }
  function renderGraph(){
    apiCall("/api/knowledge/graph").then(function(graph){
      var box=$("knowledge-graph");box.replaceChildren();
      if(!graph.nodes.length){box.textContent="Create notes and link them with [[wikilinks]] to see connections.";return;}
      var width=Math.max(520,graph.nodes.length*160),height=190;
      var svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 "+width+" "+height);svg.setAttribute("width",width);svg.setAttribute("height",height);
      var pos={};graph.nodes.forEach(function(n,i){pos[n.id]={x:70+i*150,y:80+(i%2)*45};});
      graph.edges.forEach(function(edge){if(!pos[edge.from]||!pos[edge.to])return;var line=document.createElementNS(svg.namespaceURI,"line");line.setAttribute("x1",pos[edge.from].x);line.setAttribute("y1",pos[edge.from].y);line.setAttribute("x2",pos[edge.to].x);line.setAttribute("y2",pos[edge.to].y);line.setAttribute("stroke","currentColor");line.setAttribute("opacity",".35");svg.appendChild(line);});
      graph.nodes.forEach(function(n){var g=document.createElementNS(svg.namespaceURI,"g");g.style.cursor="pointer";g.onclick=function(){selectNote(n.id).catch(showError);};
        var circle=document.createElementNS(svg.namespaceURI,"circle");circle.setAttribute("cx",pos[n.id].x);circle.setAttribute("cy",pos[n.id].y);circle.setAttribute("r","9");circle.setAttribute("fill","currentColor");g.appendChild(circle);
        var label=document.createElementNS(svg.namespaceURI,"text");label.setAttribute("x",pos[n.id].x+14);label.setAttribute("y",pos[n.id].y+5);label.setAttribute("fill","currentColor");label.setAttribute("font-size","13");label.textContent=n.title;g.appendChild(label);svg.appendChild(g);
      });box.appendChild(svg);
    }).catch(showError);
  }
  function showError(e){status.textContent=e&&e.message?e.message:"Request failed";}
  function updateWriting(){
    var content=$("knowledge-body").value,words=content.trim()?content.trim().split(/\\s+/).length:0;
    $("knowledge-word-count").textContent=words+" "+(words===1?"word":"words");
    clearTimeout(previewTimer);
    var revision=++previewRevision;
    $("knowledge-preview-status").textContent=content.trim()?"Updating preview…":"";
    if(!content.trim()){$("knowledge-preview").replaceChildren(node("p","dim","Your ideas, beautifully readable. Start writing to see a preview."));return;}
    previewTimer=setTimeout(function(){
      apiCall("/api/knowledge/preview","POST",{content:content}).then(function(data){
        if(revision!==previewRevision)return;
        $("knowledge-preview").innerHTML=data.html;
        $("knowledge-preview-status").textContent="";
      }).catch(function(e){
        if(revision!==previewRevision)return;
        $("knowledge-preview").replaceChildren();
        $("knowledge-preview-status").textContent="Preview unavailable: "+e.message;
      });
    },250);
  }
  function changed(){
    state.dirty=true;state.revision++;clearTimeout(saveTimer);
    $("knowledge-save-status").textContent="Unsaved changes";
    $("knowledge-editor-heading").textContent=$("knowledge-title").value.trim()||"Untitled note";
    updateWriting();
    saveTimer=setTimeout(function(){saveNote().catch(showError);},900);
  }
  function saveNote(){
    clearTimeout(saveTimer);
    if(savePromise)return savePromise.then(function(){return saveNote();});
    if(!state.dirty)return Promise.resolve();
    if(!$("knowledge-note-url").checkValidity()){
      $("knowledge-save-status").textContent="Not saved: enter a valid source URL.";
      return Promise.reject(new Error("Enter a valid source URL in Note properties before saving."));
    }
    var revision=state.revision;
    var body={title:$("knowledge-title").value.trim()||"Untitled",content:$("knowledge-body").value,tags:tagsFrom($("knowledge-tags").value),spaceId:$("knowledge-space-select").value||null,sourceUrl:$("knowledge-note-url").value||null};
    $("knowledge-save-status").textContent="Saving…";
    savePromise=(state.current?apiCall("/api/knowledge/notes/"+encodeURIComponent(state.current.id),"PUT",body):apiCall("/api/knowledge/notes","POST",body)).then(function(data){
      state.current=data.note;
      var index=state.notes.findIndex(function(note){return note.id===data.note.id;});
      if(index<0)state.notes.unshift(data.note);else state.notes[index]=data.note;
      state.dirty=revision!==state.revision;
      $("knowledge-save-status").textContent=state.dirty?"Unsaved changes":"Saved to your library";
      $("knowledge-delete-note").disabled=false;status.textContent="";
      render();renderBacklinks();
    }).catch(function(e){
      $("knowledge-save-status").textContent="Not saved: "+e.message+" — use Save note to retry.";
      throw e;
    }).finally(function(){savePromise=null;});
    return savePromise.then(function(){if(state.dirty)return saveNote();});
  }
  function setMode(mode){
    $("knowledge-writing").dataset.mode=mode;
    document.querySelectorAll("[data-note-mode]").forEach(function(button){button.setAttribute("aria-pressed",String(button.dataset.noteMode===mode));});
    $("knowledge-formatting").hidden=mode==="preview";
  }
  function toggleFocus(){
    var focused=document.body.classList.toggle("notes-focus");
    $("knowledge-focus").setAttribute("aria-pressed",String(focused));
    $("knowledge-focus").textContent=focused?"Exit focus":"Focus mode";
  }
  function format(kind){
    if($("knowledge-writing").dataset.mode==="preview")setMode("source");
    var editor=$("knowledge-body"),start=editor.selectionStart,end=editor.selectionEnd,selected=editor.value.slice(start,end);
    var formats={heading:["## ","","Heading"],bold:["**","**","bold text"],italic:["_","_","italic text"],bullet:["- ","","List item"],task:["- [ ] ","","Task"],quote:["> ","","Quote"],link:["[","](https://example.com)","link text"],code:["\\x60\\x60\\x60\\n","\\n\\x60\\x60\\x60","code"]};
    var parts=formats[kind];if(!parts)return;
    var prefix=parts[0],suffix=parts[1],text=selected||parts[2];
    if(["heading","bullet","task","quote","code"].indexOf(kind)>=0&&start>0&&editor.value[start-1]!=="\\n")prefix="\\n"+prefix;
    editor.setRangeText(prefix+text+suffix,start,end,"select");
    editor.focus();editor.setSelectionRange(start+prefix.length,start+prefix.length+text.length);changed();
  }
  ["knowledge-title","knowledge-body","knowledge-tags","knowledge-note-url"].forEach(function(id){$(id).oninput=changed;});
  $("knowledge-space-select").onchange=function(){changed();renderSpaceReferences();};
  document.querySelectorAll("[data-note-mode]").forEach(function(button){button.onclick=function(){setMode(button.dataset.noteMode);};});
  document.querySelectorAll("[data-note-format]").forEach(function(button){button.onclick=function(){format(button.dataset.noteFormat);};});
  $("knowledge-focus").onclick=toggleFocus;
  window.addEventListener("beforeunload",function(event){if(state.dirty||savePromise){event.preventDefault();event.returnValue="";}});
  document.addEventListener("keydown",function(event){
    if(event.key==="Escape"&&document.body.classList.contains("notes-focus")){toggleFocus();return;}
    if(!event.metaKey&&!event.ctrlKey)return;
    if(loading||transitioning)return;
    var key=event.key.toLowerCase();
    if(key==="s"){event.preventDefault();saveNote().catch(showError);}
    else if(["1","2","3"].indexOf(key)>=0){event.preventDefault();setMode({1:"source",2:"split",3:"preview"}[key]);}
    else if(key==="f"&&event.shiftKey){event.preventDefault();toggleFocus();}
    else if(event.target===$("knowledge-body")&&(key==="b"||key==="i")){event.preventDefault();format(key==="b"?"bold":"italic");}
  });
  $("knowledge-search").oninput=function(){state.query=this.value.trim().toLowerCase();render();};
  $("knowledge-all-notes").onclick=function(){state.spaceFilter=null;state.query="";$("knowledge-search").value="";render();};
  $("knowledge-new-note").onclick=function(){
    transition(function(){return saveNote().then(function(){
      openNote(null);$("knowledge-space-select").value=state.spaceFilter||"";
      render();$("knowledge-title").focus();
    });}).then(function(){$("knowledge-title").focus();}).catch(showError);
  };
  $("knowledge-new-space").onclick=function(){
    var name=prompt("Name this space");if(!name||!name.trim())return;
    var description=prompt("Optional description","")||"";
    var instructions=prompt("Optional AI instructions for this space","")||"";
    apiCall("/api/knowledge/spaces","POST",{name:name.trim(),description:description,instructions:instructions}).then(function(){status.textContent="Space created.";return load();}).catch(showError);
  };
  $("knowledge-load-records").onclick=function(){
    var select=$("knowledge-record-select"),kind=$("knowledge-record-kind").value;
    select.replaceChildren(new Option("Loading…",""));
    apiCall("/api/knowledge/records?type="+encodeURIComponent(kind)).then(function(data){
      state.recordOptions=data;
      select.replaceChildren(new Option("Choose an item",""));
      (data[kind]||[]).forEach(function(item){select.add(new Option(item.title+" — "+item.detail,kind+"|"+item.id));});
      if(!select.options.length||select.options.length===1)select.add(new Option("No items available",""));
    }).catch(showError);
  };
  $("knowledge-record-kind").onchange=function(){state.recordOptions=null;$("knowledge-record-select").replaceChildren(new Option("Load items first",""));};
  $("knowledge-add-record").onclick=function(){
    var value=$("knowledge-record-select").value,spaceId=selectedSpaceId();
    if(!spaceId){status.textContent="Choose a space first.";return;}
    if(!value){status.textContent="Load and select an item first.";return;}
    var split=value.indexOf("|");
    apiCall("/api/knowledge/space-references","POST",{spaceId:spaceId,type:value.slice(0,split),targetId:value.slice(split+1)})
      .then(function(){status.textContent="Item linked to the space.";return load();}).catch(showError);
  };
  $("knowledge-save-note").onclick=function(){
    saveNote().catch(showError);
  };
  $("knowledge-delete-note").onclick=function(){
    if(transitioning||!state.current||!confirm("Delete this note?"))return;
    clearTimeout(saveTimer);
    var button=this;button.disabled=true;
    var id=state.current.id;
    transition(function(){return saveNote().then(function(){return apiCall("/api/knowledge/notes/"+encodeURIComponent(id),"DELETE");}).then(function(){
      state.notes=state.notes.filter(function(note){return note.id!==id;});
      openNote(state.notes[0]||null);render();renderGraph();status.textContent="Note deleted.";
    });}).catch(showError).finally(function(){button.disabled=!state.current;});
  };
  $("knowledge-source-form").onsubmit=function(event){
    event.preventDefault();
    apiCall("/api/knowledge/sources","POST",{title:$("knowledge-source-title").value,url:$("knowledge-source-url").value,excerpt:$("knowledge-source-excerpt").value,tags:tagsFrom($("knowledge-source-tags").value),spaceId:$("knowledge-space-select").value||null})
      .then(function(){$("knowledge-source-form").reset();status.textContent="Link saved.";return load();}).catch(showError);
  };
  $("knowledge-import-file").onchange=function(){
    var file=this.files&&this.files[0];if(!file)return;
    file.text().then(function(content){
      if(/\\.json$/i.test(file.name))return apiCall("/api/knowledge/import.json","POST",JSON.parse(content)).then(function(result){return {backup:true,result:result};});
      return apiCall("/api/knowledge/import","POST",{title:file.name.replace(/\\.md$/i,""),markdown:content}).then(function(){return {backup:false};});
    }).then(function(result){
      status.textContent=result.backup?"Backup merged: "+result.result.notes+" notes, "+result.result.sources+" sources, "+result.result.spaces+" spaces added; "+result.result.skipped+" duplicates skipped.":"Markdown imported as a note.";
      return load();
    }).catch(showError).finally(function(){$("knowledge-import-file").value="";});
  };
  $("knowledge-ask").onclick=function(){
    var spaceId=$("knowledge-ask-space").value,question=$("knowledge-question").value.trim();
    if(!spaceId||!question){$("knowledge-answer").textContent="Choose a space and enter a question.";return;}
    $("knowledge-answer").textContent="Working…";$("knowledge-citations").replaceChildren();
    apiCall("/api/knowledge/ask","POST",{spaceId:spaceId,question:question}).then(function(data){
      $("knowledge-answer").textContent=data.answer;
      (data.citations||[]).forEach(function(citation){
        var link=node("a","btn ghost","["+citation.number+"] "+citation.title);
        var href=safeUrl(citation.url)||(["/board","/calendar"].indexOf(citation.url)>=0?citation.url:null);
        link.href=href||"#";
        if(safeUrl(citation.url)){link.target="_blank";link.rel="noopener noreferrer";}
        $("knowledge-citations").appendChild(link);
      });
    }).catch(function(e){$("knowledge-answer").textContent=e.message||"Could not answer";});
  };
  load().then(renderGraph).catch(showError);
})();`,
  });
}
