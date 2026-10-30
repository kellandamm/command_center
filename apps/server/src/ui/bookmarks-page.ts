import { page, type NavLink } from "./layout";
import { button, field, pageHeader } from "./components";
import { PHASE2_PAGE_CSS } from "./phase2-pages-css";

export function bookmarksPage(nav?: NavLink[]): string {
  const headerActions = `${button({ label: "Add bookmark", attrs: { id: "bookmark-add", disabled: true } })}${button({ label: "New group", variant: "ghost", attrs: { id: "bookmark-new-group", disabled: true } })}`;
  return page({
    title: "Bookmarks — Command center",
    active: "/bookmarks",
    nav,
    extraCss: PHASE2_PAGE_CSS,
    body: `<div class="phase2-page bookmark-page">
${pageHeader({ title: "Bookmarks", description: "Favorite places. One clear view.", actionsHtml: headerActions })}
<div class="phase2-toolbar">
${field({ label: "Find a bookmark", id: "bookmark-search", inputHtml: '<input id="bookmark-search" type="search" placeholder="Search titles, links, groups…" autocomplete="off" />' })}
  <details class="bookmark-options"><summary class="btn btn-outline btn-sm">Layout &amp; files</summary><div class="bookmark-options-body">
    <label for="bookmark-density">Spacing</label><select id="bookmark-density" disabled><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select>
    <label for="bookmark-columns">Columns</label><select id="bookmark-columns" disabled><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="4">4</option></select>
    <label class="btn btn-outline btn-sm bookmark-import-label" for="bookmark-import">Import bookmarks</label><input id="bookmark-import" type="file" accept=".html,.htm,.json,text/html,application/json" disabled>
    <p class="dim">Import a browser bookmarks HTML export or a Bookmarks JSON backup. Folder paths become groups; duplicate URLs within a group are skipped.</p>
    ${button({ label: "Download backup", variant: "outline", size: "sm", href: "/api/bookmarks/export.json" })}
  </div></details>
</div>
<p id="bookmark-status" role="status" aria-live="polite">Loading bookmarks…</p>
<div id="bookmark-groups" class="bookmark-grid" aria-label="Bookmark groups"></div>
<dialog id="bookmark-dialog" class="ui-dialog" aria-labelledby="bookmark-dialog-title">
  <form id="bookmark-form">
    <h2 id="bookmark-dialog-title">Add bookmark</h2>
    <input id="bookmark-id" type="hidden">
    <label for="bookmark-title">Title</label><input id="bookmark-title" maxlength="240" required>
    <label for="bookmark-url">URL</label><input id="bookmark-url" type="url" placeholder="https://" maxlength="2048" required>
    <label for="bookmark-group">Group</label><select id="bookmark-group" required></select>
    <label for="bookmark-description">Description (optional)</label><input id="bookmark-description" maxlength="1000">
    <p id="bookmark-form-error" class="bad" role="alert"></p>
    <div class="row"><button type="submit" id="bookmark-submit">Save bookmark</button><button type="button" id="bookmark-cancel" class="ghost">Cancel</button></div>
  </form>
</dialog>
</div>
<style>
.bookmark-page .bookmark-options summary{list-style:none;cursor:pointer}
.bookmark-options-body{padding:0 .5rem 1rem}.bookmark-options-body p{font-size:.75rem}
.bookmark-options-body label.field-label,.bookmark-options-body label{font-size:.875rem;margin:.75rem 0 .35rem}
.bookmark-grid{display:grid;grid-template-columns:repeat(var(--bookmark-columns,3),minmax(0,1fr));gap:var(--grid-gap);align-items:start}
.bookmark-group{min-width:0;padding:var(--card-pad);background:var(--card);border-radius:calc(var(--radius) + 0.25rem);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--foreground) 6%,transparent),0 1px 2px rgba(0,0,0,.04)}
html.dark .bookmark-group{box-shadow:0 0 0 1px color-mix(in srgb,var(--foreground) 10%,transparent),0 1px 2px rgba(0,0,0,.35)}
.bookmark-group-head{display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem}.bookmark-group-head h2{margin:0;flex:1;overflow-wrap:anywhere;font-size:1rem}
.bookmark-count{font-size:.75rem;color:var(--dim)}
.bookmark-actions{position:relative}.bookmark-actions summary{cursor:pointer;font-size:.75rem;color:var(--dim);padding:.3rem}
.bookmark-actions[open]{z-index:2}.bookmark-menu{position:absolute;right:0;top:100%;display:grid;gap:.3rem;padding:.5rem;width:10rem;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 4px 16px rgba(0,0,0,.1)}
.bookmark-menu button{font-size:.75rem;justify-content:flex-start;min-height:1.8rem;padding:.25rem .5rem}
.bookmark-list{list-style:none;margin:0;padding:0;display:grid;gap:.25rem}
.bookmark-item{display:flex;align-items:center;gap:.35rem;border-radius:calc(var(--radius) - 2px)}
.bookmark-item:hover{background:var(--muted)}.bookmark-link{display:flex;gap:.75rem;align-items:center;min-width:0;flex:1;padding:.6rem .35rem;border-radius:calc(var(--radius) - 2px)}
.bookmark-monogram{display:grid;place-items:center;width:2rem;height:2rem;flex-shrink:0;background:var(--muted);border:1px solid var(--border);border-radius:.5rem;font-weight:600;font-size:.75rem}
.bookmark-copy{min-width:0}.bookmark-copy strong{display:block;font-size:.85rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bookmark-copy small{display:block;font-size:.7rem;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bookmark-empty{padding:2rem 0;color:var(--dim);grid-column:1/-1}
.bookmark-empty h2{font-size:1rem;line-height:1.4;font-weight:600;margin:0}
.bookmark-page[data-density=compact] .bookmark-link{padding:.3rem}.bookmark-page[data-density=compact] .bookmark-monogram{width:1.5rem;height:1.5rem;font-size:.65rem}
.bookmark-page[data-density=compact] .bookmark-copy small{display:none}
#bookmark-dialog{width:min(30rem,calc(100% - 2rem));max-height:90vh;overflow:auto;padding:1.5rem}
@media(max-width:1200px){.bookmark-grid{grid-template-columns:repeat(min(var(--bookmark-columns,3),2),minmax(0,1fr))}}
@media(max-width:650px){.bookmark-grid{grid-template-columns:minmax(0,1fr)}}
</style>`,
    script: `
(function(){
  var $=function(id){return document.getElementById(id);};
  var state={groups:[],bookmarks:[],preferences:{density:"comfortable",columns:3}},busy=false,ready=false;
  function node(tag,cls,text){var element=document.createElement(tag);if(cls)element.className=cls;if(text!==undefined)element.textContent=text;return element;}
  function error(e){$("bookmark-status").textContent=e.message||"Request failed";$("bookmark-status").className="bad";}
  function setBusy(value){
    busy=value;
    ["bookmark-add","bookmark-new-group","bookmark-density","bookmark-columns","bookmark-import","bookmark-submit"].forEach(function(id){$(id).disabled=value||!ready;});
  }
  function load(){
    return api("/api/bookmarks").then(function(data){
      state=data;ready=true;
      $("bookmark-density").value=data.preferences.density;$("bookmark-columns").value=data.preferences.columns;
      render();
    });
  }
  function mutate(path,method,body,message){
    if(busy)return Promise.resolve(false);
    setBusy(true);
    return api("/api/bookmarks/"+path,method,body).then(function(result){
      return load().then(function(){$("bookmark-status").className="dim";$("bookmark-status").textContent=typeof message==="function"?message(result):message;return true;});
    }).catch(function(e){error(e);throw e;}).finally(function(){setBusy(false);});
  }
  function action(menu,text,callback){
    var button=node("button","ghost",text);button.type="button";
    button.onclick=function(){if(busy)return;callback();};menu.appendChild(button);
  }
  function actions(label){
    var details=node("details","bookmark-actions"),summary=node("summary","", "Manage");
    summary.setAttribute("aria-label",label);details.appendChild(summary);
    var menu=node("div","bookmark-menu");details.appendChild(menu);
    return {details:details,menu:menu};
  }
  function render(){
    var root=document.querySelector(".bookmark-page"),container=$("bookmark-groups"),query=$("bookmark-search").value.trim().toLowerCase();
    root.dataset.density=state.preferences.density;container.style.setProperty("--bookmark-columns",state.preferences.columns);
    container.replaceChildren();
    state.groups.forEach(function(group){
      var items=state.bookmarks.filter(function(item){return item.groupId===group.id&&(!query||(group.name+" "+item.title+" "+item.url+" "+item.description).toLowerCase().includes(query));});
      if(query&&!items.length&&!group.name.toLowerCase().includes(query))return;
      var section=node("section","bookmark-group"),heading=node("div","bookmark-group-head"),name=node("h2","",group.name);
      heading.appendChild(name);heading.appendChild(node("span","bookmark-count",items.length));
      var groupActions=actions("Manage group "+group.name);
      action(groupActions.menu,"Add bookmark",function(){openEditor(null,group.id);});
      action(groupActions.menu,"Rename group",function(){
        var name=prompt("Group name",group.name);if(name===null)return;
        mutate("groups","PATCH",{id:group.id,name:name},"Group renamed.").catch(function(){});
      });
      ["up","down"].forEach(function(direction){action(groupActions.menu,"Move "+direction,function(){
        mutate("groups","PATCH",{id:group.id,direction:direction},"Group moved.").catch(function(){});
      });});
      action(groupActions.menu,"Delete empty group",function(){
        if(!confirm("Delete group "+group.name+"? Only empty groups can be removed."))return;
        mutate("groups","DELETE",{id:group.id},"Group deleted.").catch(function(){});
      });
      heading.appendChild(groupActions.details);section.appendChild(heading);
      var list=node("ul","bookmark-list");
      items.forEach(function(item){
        var row=node("li","bookmark-item"),link=node("a","bookmark-link"),host;
        try{var url=new URL(item.url);if(["http:","https:"].indexOf(url.protocol)<0)throw new Error("Unsafe URL");host=url.hostname;}catch(e){error(new Error("Bookmark contains an invalid URL: "+item.title));return;}
        link.href=item.url;link.target="_blank";link.rel="noopener noreferrer";link.title=item.description||item.url;
        link.appendChild(node("span","bookmark-monogram",host.replace(/^www\\./,"").slice(0,2).toUpperCase()));
        var copy=node("span","bookmark-copy");copy.appendChild(node("strong","",item.title));copy.appendChild(node("small","",item.description||host));link.appendChild(copy);row.appendChild(link);
        var controls=actions("Manage bookmark "+item.title);
        action(controls.menu,"Edit or move",function(){openEditor(item);});
        ["up","down"].forEach(function(direction){action(controls.menu,"Move "+direction,function(){
          mutate("items","PATCH",{id:item.id,direction:direction},"Bookmark moved.").catch(function(){});
        });});
        action(controls.menu,"Remove bookmark",function(){
          if(confirm("Remove "+item.title+"?"))mutate("items","DELETE",{id:item.id},"Bookmark removed.").catch(function(){});
        });
        row.appendChild(controls.details);list.appendChild(row);
      });
      if(!items.length)list.appendChild(node("li","dim","No bookmarks here yet."));
      section.appendChild(list);container.appendChild(section);
    });
    if(!container.children.length){
      var empty=node("div","bookmark-empty ui-empty");empty.appendChild(node("h2","ui-empty-title",query?"No matching bookmarks":"Your internet, organized."));
      empty.appendChild(node("p","ui-empty-desc dim",query?"Try a different search.":"Create a group to add your favorite links, or import a browser bookmark export from Layout & files."));
      container.appendChild(empty);
    }
  }
  function openEditor(bookmark,groupId){
    if(busy||!ready)return;
    if(!state.groups.length){$("bookmark-status").textContent="Create a group first.";return;}
    $("bookmark-form").reset();$("bookmark-form-error").textContent="";
    $("bookmark-dialog-title").textContent=bookmark?"Edit bookmark":"Add bookmark";
    $("bookmark-id").value=bookmark?bookmark.id:"";
    $("bookmark-title").value=bookmark?bookmark.title:"";
    $("bookmark-url").value=bookmark?bookmark.url:"";
    $("bookmark-description").value=bookmark?bookmark.description:"";
    $("bookmark-group").replaceChildren();
    state.groups.forEach(function(group){$("bookmark-group").add(new Option(group.name,group.id));});
    $("bookmark-group").value=bookmark?bookmark.groupId:groupId||state.groups[0].id;
    $("bookmark-dialog").showModal();$("bookmark-title").focus();
  }
  function parseBrowserBookmarks(content){
    var doc=new DOMParser().parseFromString(content,"text/html"),groups=[],bookmarks=[],byName=new Map(),skipped=0;
    function group(name){
      if(byName.has(name))return byName.get(name);
      var id="import-"+groups.length;groups.push({id:id,name:name.slice(0,240)});byName.set(name,id);return id;
    }
    doc.querySelectorAll("a[href]").forEach(function(link){
      var raw=link.getAttribute("href"),url;
      try{url=new URL(raw);if(["http:","https:"].indexOf(url.protocol)<0||url.username||url.password)throw new Error();}catch(e){skipped++;return;}
      var parts=[],current=link.parentElement;
      while(current&&current!==doc.body){
        if(current.tagName==="DL"){
          var previous=current.previousElementSibling;
          var heading=previous&&(previous.tagName==="H3"?previous:previous.querySelector("h3"));
          if(!heading&&current.parentElement&&current.parentElement.tagName==="DT")heading=Array.from(current.parentElement.children).find(function(el){return el.tagName==="H3";});
          if(heading&&heading.textContent.trim())parts.unshift(heading.textContent.trim());
        }
        current=current.parentElement;
      }
      bookmarks.push({groupId:group(parts.join(" / ")||"Imported bookmarks"),title:(link.textContent.trim()||url.hostname).slice(0,240),url:url.href,description:""});
    });
    if(!bookmarks.length)throw new Error("No HTTP/HTTPS bookmarks found. Choose a browser bookmarks HTML export.");
    return {data:{groups:groups,bookmarks:bookmarks},skipped:skipped};
  }
  $("bookmark-search").oninput=render;
  $("bookmark-add").onclick=function(){openEditor(null);};
  $("bookmark-new-group").onclick=function(){
    var name=prompt("Group name");if(name===null)return;
    mutate("groups","POST",{name:name},"Group created.").catch(function(){});
  };
  $("bookmark-cancel").onclick=function(){$("bookmark-dialog").close();};
  $("bookmark-dialog").addEventListener("cancel",function(event){if(busy)event.preventDefault();});
  $("bookmark-form").onsubmit=function(event){
    event.preventDefault();if(busy)return;
    var id=$("bookmark-id").value,body={title:$("bookmark-title").value,url:$("bookmark-url").value,groupId:$("bookmark-group").value,description:$("bookmark-description").value};
    if(id)body.id=id;
    mutate("items",id?"PUT":"POST",body,"Bookmark saved.").then(function(saved){if(saved)$("bookmark-dialog").close();}).catch(function(e){$("bookmark-form-error").textContent=e.message;});
  };
  function saveLayout(){
    mutate("preferences","PUT",{density:$("bookmark-density").value,columns:Number($("bookmark-columns").value)},"Layout saved.").catch(function(){
      $("bookmark-density").value=state.preferences.density;$("bookmark-columns").value=state.preferences.columns;
    });
  }
  $("bookmark-density").onchange=saveLayout;$("bookmark-columns").onchange=saveLayout;
  $("bookmark-import").onchange=function(){
    var file=this.files&&this.files[0];if(!file||busy)return;
    if(file.size>5_000_000){error(new Error("Choose a file smaller than 5 MB."));this.value="";return;}
    setBusy(true);
    file.text().then(function(content){
      var imported=/\\.json$/i.test(file.name)?{data:JSON.parse(content),skipped:0}:parseBrowserBookmarks(content);
      setBusy(false);
      return mutate("import","POST",imported.data,function(result){return "Imported "+result.added+" bookmarks; "+result.skipped+" duplicates skipped"+(imported.skipped?"; "+imported.skipped+" unsupported URLs skipped":"")+".";});
    }).catch(error).finally(function(){setBusy(false);$("bookmark-import").value="";});
  };
  load().then(function(){$("bookmark-status").textContent="";setBusy(false);}).catch(error);
})();`,
  });
}
