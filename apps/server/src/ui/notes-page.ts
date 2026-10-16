import type { NavLink } from "./layout";
import { page } from "./layout";

export function notesPage(nav?: NavLink[]): string {
  return page({
    title: "Knowledge — Command center",
    active: "/notes",
    nav,
    body: `<header class="page-header"><h1>Knowledge</h1><p class="dim">Markdown notes, captured links, and personal spaces. Export your knowledge at any time.</p></header>
<div class="row" style="margin-bottom:1rem">
  <button id="knowledge-new-note" type="button">New note</button>
  <button id="knowledge-new-space" class="ghost" type="button">New space</button>
  <a class="btn ghost" href="/api/knowledge/export.md">Export Markdown</a>
  <a class="btn ghost" href="/api/knowledge/export.json">Download backup</a>
  <label class="btn ghost" style="margin:0;cursor:pointer">Import file<input id="knowledge-import-file" type="file" accept=".md,.json,text/markdown,application/json" hidden></label>
</div>
<div style="display:grid;grid-template-columns:minmax(16rem,24rem) minmax(0,1fr);gap:1rem;align-items:start">
  <aside class="card" style="padding:1rem">
    <label for="knowledge-search">Search your knowledge</label>
    <input id="knowledge-search" type="search" placeholder="Search notes and captured links">
    <h2 style="margin-top:1.25rem">Spaces</h2><div id="knowledge-spaces" class="row"></div>
    <h2 style="margin-top:1.25rem">Space references</h2><div id="knowledge-space-references" class="dim"></div>
    <details style="margin-top:.75rem">
      <summary style="cursor:pointer;font-weight:600">Link a Board or Calendar item</summary>
      <label for="knowledge-record-kind">Item type</label><select id="knowledge-record-kind"><option value="board">Board card</option><option value="calendar">Calendar event</option></select>
      <button id="knowledge-load-records" class="ghost" type="button" style="margin-top:.5rem">Load items</button>
      <label for="knowledge-record-select">Item</label><select id="knowledge-record-select"><option value="">Load items first</option></select>
      <button id="knowledge-add-record" type="button" style="margin-top:.5rem">Link to selected space</button>
    </details>
    <h2 style="margin-top:1.25rem">Notes</h2><div id="knowledge-note-list"></div>
    <h2 style="margin-top:1.25rem">Captured links</h2><div id="knowledge-source-list"></div>
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
  </aside>
  <main>
    <section class="card" id="knowledge-editor">
      <div class="row" style="justify-content:space-between"><h2 id="knowledge-editor-heading">Select or create a note</h2><span id="knowledge-save-status" class="dim" aria-live="polite"></span></div>
      <label for="knowledge-title">Title</label><input id="knowledge-title" maxlength="240">
      <label for="knowledge-body">Markdown</label><textarea id="knowledge-body" spellcheck="true" style="min-height:24rem"></textarea>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:.75rem">
        <div><label for="knowledge-tags">Tags (comma-separated)</label><input id="knowledge-tags" placeholder="research, ideas"></div>
        <div><label for="knowledge-space-select">Space</label><select id="knowledge-space-select"><option value="">No space</option></select></div>
        <div><label for="knowledge-note-url">Source URL (optional)</label><input id="knowledge-note-url" type="url"></div>
      </div>
      <div class="row" style="margin-top:.75rem">
        <button id="knowledge-save-note" type="button">Save note</button>
        <button id="knowledge-delete-note" class="ghost" type="button" disabled>Delete note</button>
      </div>
      <div id="knowledge-backlinks" class="dim" style="margin-top:1rem"></div>
    </section>
    <section class="card" style="margin-top:1rem">
      <h2>Ask this space</h2>
      <p class="dim">Questions use only notes and captured sources assigned to the selected space. Content is sent to the configured LLM only when you ask, with a limit of 10 questions per hour.</p>
      <label for="knowledge-ask-space">Space</label><select id="knowledge-ask-space"><option value="">Choose a space</option></select>
      <label for="knowledge-question">Question</label><textarea id="knowledge-question" style="min-height:5rem" placeholder="What do my sources say about…"></textarea>
      <button id="knowledge-ask" type="button" style="margin-top:.75rem">Ask with sources</button>
      <div id="knowledge-answer" style="white-space:pre-wrap;margin-top:1rem"></div>
      <div id="knowledge-citations" class="row"></div>
    </section>
    <details class="card" style="margin-top:1rem">
      <summary style="cursor:pointer;font-weight:600">Note link graph</summary>
      <p class="dim">Add links in Markdown using <code>[[Note title]]</code>. Click a note node to open it.</p>
      <div id="knowledge-graph" style="overflow:auto"></div>
    </details>
    <div id="knowledge-status" class="dim" aria-live="polite" style="margin-top:.75rem"></div>
  </main>
</div>
<style>@media(max-width:800px){.page-content>div[style*="grid-template-columns:minmax(16rem"]{grid-template-columns:1fr!important}}</style>`,
    script: `
(function(){
  var state={notes:[],sources:[],spaces:[],current:null,spaceFilter:null,query:"",recordOptions:null};
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
    state.notes.filter(function(note){return (!state.spaceFilter||note.spaceId===state.spaceFilter)&&matchesQuery(note.title+"\\n"+note.content+"\\n"+(note.tags||[]).join(" "));}).forEach(function(note){
      addRow(noteList,note.title,(note.tags||[]).map(function(t){return "#"+t;}).join(" ")||note.updatedAt.slice(0,10),function(){selectNote(note.id);});
    });
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
      if(state.current){var updated=state.notes.find(function(n){return n.id===state.current.id;});if(updated)state.current=updated;else selectNote(null,false);}
      else if(state.notes.length)selectNote(state.notes[0].id,false);
    }).catch(showError);
  }
  function selectNote(id,loadGraph){
    state.current=id?state.notes.find(function(n){return n.id===id;})||null:null;
    $("knowledge-title").value=state.current?state.current.title:"";
    $("knowledge-body").value=state.current?state.current.content:"";
    $("knowledge-tags").value=state.current?(state.current.tags||[]).join(", "):"";
    $("knowledge-space-select").value=state.current?(state.current.spaceId||""):"";
    $("knowledge-note-url").value=state.current?(state.current.sourceUrl||""):"";
    $("knowledge-editor-heading").textContent=state.current?state.current.title:"New note";
    $("knowledge-delete-note").disabled=!state.current;
    renderBacklinks();
    renderSpaceReferences();
    if(loadGraph!==false)renderGraph();
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
      var b=node("button","ghost",note.title);b.type="button";b.onclick=function(){selectNote(note.id);};el.appendChild(b);
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
      graph.nodes.forEach(function(n){var g=document.createElementNS(svg.namespaceURI,"g");g.style.cursor="pointer";g.onclick=function(){selectNote(n.id);};
        var circle=document.createElementNS(svg.namespaceURI,"circle");circle.setAttribute("cx",pos[n.id].x);circle.setAttribute("cy",pos[n.id].y);circle.setAttribute("r","9");circle.setAttribute("fill","currentColor");g.appendChild(circle);
        var label=document.createElementNS(svg.namespaceURI,"text");label.setAttribute("x",pos[n.id].x+14);label.setAttribute("y",pos[n.id].y+5);label.setAttribute("fill","currentColor");label.setAttribute("font-size","13");label.textContent=n.title;g.appendChild(label);svg.appendChild(g);
      });box.appendChild(svg);
    }).catch(showError);
  }
  function showError(e){status.textContent=e&&e.message?e.message:"Request failed";}
  $("knowledge-search").oninput=function(){state.query=this.value.trim().toLowerCase();render();};
  $("knowledge-new-note").onclick=function(){
    apiCall("/api/knowledge/notes","POST",{title:"Untitled",content:""}).then(function(data){status.textContent="";return load().then(function(){selectNote(data.note.id);});}).catch(showError);
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
    var body={title:$("knowledge-title").value,content:$("knowledge-body").value,tags:tagsFrom($("knowledge-tags").value),spaceId:$("knowledge-space-select").value||null,sourceUrl:$("knowledge-note-url").value||null};
    $("knowledge-save-status").textContent="Saving…";
    var action=state.current?apiCall("/api/knowledge/notes/"+encodeURIComponent(state.current.id),"PUT",body):apiCall("/api/knowledge/notes","POST",body);
    action.then(function(data){$("knowledge-save-status").textContent="Saved";return load().then(function(){selectNote(data.note.id,false);});}).catch(function(e){$("knowledge-save-status").textContent=e.message||"Save failed";});
  };
  $("knowledge-delete-note").onclick=function(){
    if(!state.current||!confirm("Delete this note?"))return;
    apiCall("/api/knowledge/notes/"+encodeURIComponent(state.current.id),"DELETE").then(function(){state.current=null;status.textContent="Note deleted.";return load();}).catch(showError);
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
  load();
})();`,
  });
}
