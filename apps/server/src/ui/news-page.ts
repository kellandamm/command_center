import type { NavLink } from "./layout";
import { page } from "./layout";

export function newsPage(nav?: NavLink[]): string {
  return page({
    title: "News — Command center",
    active: "/news",
    nav,
    body: `<div class="page-content rss-page">
<header class="page-header" style="margin-bottom:.25rem">
  <h1>News</h1>
  <p class="dim">RSS reader with topic focus and mute — import your OPML anytime.</p>
</header>
<div class="card rss-topics">
  <div class="tag-chip-bar" id="news-focus-chips" role="group" aria-label="Focus topics"></div>
  <p class="dim" style="margin:.5rem 0 0;font-size:.75rem">Click to focus · Shift+click to mute · Right-click chip to mute</p>
</div>
<div class="rss-workspace">
  <aside class="rss-sidebar" aria-label="Feeds">
    <div class="rss-sidebar-head row" style="justify-content:space-between">
      <span>Feeds</span>
      <span class="dim" id="rss-unread-total"></span>
    </div>
    <div class="rss-tree" id="rss-tree"></div>
    <div style="padding:.5rem .75rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.35rem">
      <button type="button" class="ghost" id="rss-organize" style="width:100%">Organize feeds</button>
      <button type="button" class="ghost" id="rss-add-folder" style="width:100%">New folder</button>
      <button type="button" class="ghost" id="rss-add-feed" style="width:100%">Add feed</button>
    </div>
  </aside>
  <div class="rss-main">
    <section class="rss-list-pane" id="rss-list-pane" aria-label="Articles">
      <div class="rss-toolbar row">
        <button type="button" class="ghost" id="rss-view-toggle">Dense list</button>
        <button type="button" class="ghost" id="rss-mark-read">Mark all read</button>
        <button type="button" class="ghost" id="news-refresh">Refresh</button>
        <label class="row choice-row" style="margin:0;font-size:.75rem"><input type="checkbox" id="rss-unread-only"/> Unread only</label>
        <input type="search" id="rss-search" placeholder="Search articles" autocomplete="off"/>
        <button type="button" class="ghost" id="rss-opml-export">Export OPML</button>
        <button type="button" class="ghost" id="rss-opml-import">Import OPML</button>
        <input type="file" id="rss-opml-file" accept=".opml,.xml" hidden/>
      </div>
      <div class="rss-articles" id="rss-articles"></div>
    </section>
    <section class="rss-read-pane hidden" id="rss-read-pane" aria-label="Reading pane">
      <div class="rss-read-head row" style="flex-wrap:wrap">
        <button type="button" class="ghost" id="rss-close-read">Close</button>
        <button type="button" class="ghost" id="rss-star">Star</button>
        <button type="button" class="ghost" id="rss-summarize" disabled>Summarize</button>
        <button type="button" class="ghost" id="rss-recallio" disabled>Save to Recallio</button>
        <a id="rss-open-ext" href="#" target="_blank" rel="noopener" class="btn ghost">Open original</a>
        <span class="dim" id="rss-action-status" style="font-size:.75rem;flex:1 1 100%"></span>
      </div>
      <div class="rss-read-head" id="rss-read-title"></div>
      <div class="rss-read-body" id="rss-read-body"></div>
      <div class="rss-read-head" id="rss-ai-summary" style="display:none;border-top:1px solid var(--border)">
        <h3 style="margin:0;font-size:.8125rem">AI summary</h3>
        <p id="rss-ai-summary-text" style="margin:.5rem 0 0;font-size:.875rem"></p>
      </div>
    </section>
  </div>
</div>
</div>`,
    script: newsPageScript(),
  });
}

function newsPageScript(): string {
  return `
var rssState={view:"dense",scope:{type:"all"},items:[],selected:null,tree:null,prefs:{mutedTags:[],focusTags:[]},tags:[],listMeta:{total:0,filtered:0},organize:false};
function setOrganize(on){
  rssState.organize=on;
  var tree=document.getElementById("rss-tree");
  if(tree)tree.classList.toggle("organize",on);
  var btn=document.getElementById("rss-organize");
  if(btn){btn.textContent=on?"Done organizing":"Organize feeds";btn.classList.toggle("on",on)}
}
function collapsedFolders(){try{return new Set(JSON.parse(localStorage.getItem("rss-tree-collapsed")||"[]"))}catch(e){return new Set()}}
function setCollapsedFolders(set){localStorage.setItem("rss-tree-collapsed",JSON.stringify(Array.from(set)))}
function tagLabel(id){var t=rssState.tags.find(function(x){return x.id===id});return t?t.label:id}
function relAge(iso){if(!iso)return"";var s=Math.max(0,Math.floor((Date.now()-Date.parse(iso))/1000));if(s<60)return s+"m";if(s<3600)return Math.floor(s/60)+"m";if(s<86400)return Math.floor(s/3600)+"h";return Math.floor(s/86400)+"d"}
function savePrefs(patch){
  return api("/api/news/prefs","PUT",Object.assign({},rssState.prefs,patch)).then(function(r){
    rssState.prefs=r.prefs;renderChips();loadArticles();
  });
}
function toggleFocus(id){
  var focus=rssState.prefs.focusTags.slice();
  var i=focus.indexOf(id);
  if(i>=0)focus.splice(i,1);else focus.push(id);
  return savePrefs({focusTags:focus});
}
function toggleMute(id){
  var muted=rssState.prefs.mutedTags.slice();
  var i=muted.indexOf(id);
  if(i>=0)muted.splice(i,1);else muted.push(id);
  var focus=rssState.prefs.focusTags.filter(function(t){return muted.indexOf(t)<0});
  return savePrefs({mutedTags:muted,focusTags:focus});
}
function renderChips(){
  var bar=document.getElementById("news-focus-chips");
  var muted=new Set(rssState.prefs.mutedTags||[]);
  var focus=new Set(rssState.prefs.focusTags||[]);
  bar.innerHTML=rssState.tags.map(function(t){
    var cls="tag-chip";
    if(muted.has(t.id))cls+=" muted";
    else if(focus.has(t.id))cls+=" on";
    return '<button type="button" class="'+cls+'" data-id="'+esc(t.id)+'">'+esc(t.label)+'</button>';
  }).join("");
  bar.querySelectorAll(".tag-chip").forEach(function(btn){
    btn.onclick=function(e){
      var id=btn.dataset.id;
      if(e.shiftKey)toggleMute(id);
      else if(!btn.classList.contains("muted"))toggleFocus(id);
    };
    btn.oncontextmenu=function(e){e.preventDefault();toggleMute(btn.dataset.id);return false};
  });
}
function filterTags(items){
  var muted=new Set(rssState.prefs.mutedTags||[]);
  var focus=rssState.prefs.focusTags.length?new Set(rssState.prefs.focusTags):null;
  return items.filter(function(it){
    var tags=it.tags||[];
    if(!tags.length)return true;
    var visible=tags.filter(function(t){return !muted.has(t)});
    if(!visible.length)return false;
    if(!focus)return true;
    return visible.some(function(t){return focus.has(t)});
  });
}
function feedMoveSelect(feedId){
  var opts=rssState.tree&&rssState.tree.folderOptions?rssState.tree.folderOptions:[];
  var html='<option value="">—</option>';
  opts.forEach(function(o){html+='<option value="'+esc(o.id)+'">'+esc(o.label)+'</option>'});
  return '<select class="tree-feed-move" data-feed="'+esc(feedId)+'" title="Move to folder">'+html+'</select>';
}
function renderFolderNode(f,depth){
  var collapsed=collapsedFolders();
  var isCollapsed=collapsed.has(f.id);
  var pad=(depth*0.75+0.35)+"rem";
  var on=rssState.scope.type==="folder"&&rssState.scope.id===f.id;
  var html='<div class="tree-folder">';
  html+='<div class="tree-folder-row" style="padding-left:'+pad+'">';
  html+='<button type="button" class="tree-toggle" data-collapse="'+esc(f.id)+'">'+(isCollapsed?"▸":"▾")+'</button>';
  html+='<button type="button" class="tree-item tree-folder-btn'+(on?" on":"")+'" data-scope="folder" data-id="'+esc(f.id)+'">'+esc(f.name)+' <span class="count">'+esc(f.unread)+'</span></button>';
  html+='<span class="tree-folder-actions"><button type="button" class="tree-act" data-act="rename" data-folder="'+esc(f.id)+'">Rename</button>'
    +'<button type="button" class="tree-act" data-act="subfolder" data-folder="'+esc(f.id)+'">+Sub</button>'
    +'<button type="button" class="tree-act" data-act="delete" data-folder="'+esc(f.id)+'">Delete</button></span>';
  html+='</div>';
  if(!isCollapsed){
    (f.feeds||[]).forEach(function(fd){html+=renderFeedRow(fd,depth+1)});
    (f.folders||[]).forEach(function(ch){html+=renderFolderNode(ch,depth+1)});
  }
  html+='</div>';
  return html;
}
function renderFeedRow(fd,depth){
  var pad=(depth*0.75+0.75)+"rem";
  var on=rssState.scope.type==="feed"&&rssState.scope.id===fd.id;
  return '<div class="tree-feed-row" style="padding-left:'+pad+'"><button type="button" class="tree-item tree-feed'+(on?" on":"")+'" data-scope="feed" data-id="'+esc(fd.id)+'">'+esc(fd.title)+' <span class="count">'+esc(fd.unread)+'</span></button>'+feedMoveSelect(fd.id)+'</div>';
}
function renderTree(){
  var el=document.getElementById("rss-tree");
  var t=rssState.tree;if(!t){el.innerHTML="";return}
  document.getElementById("rss-unread-total").textContent=t.unreadTotal?t.unreadTotal+" unread":"";
  var html='<button type="button" class="tree-item'+(rssState.scope.type==="all"?" on":"")+'" data-scope="all">Newsfeed <span class="count">'+esc(t.unreadTotal)+'</span></button>';
  (t.folders||[]).forEach(function(f){html+=renderFolderNode(f,0)});
  (t.rootFeeds||[]).forEach(function(fd){html+=renderFeedRow(fd,0)});
  el.innerHTML=html;
  el.querySelectorAll(".tree-toggle").forEach(function(btn){
    btn.onclick=function(e){e.stopPropagation();var id=btn.dataset.collapse;var c=collapsedFolders();if(c.has(id))c.delete(id);else c.add(id);setCollapsedFolders(c);renderTree()};
  });
  el.querySelectorAll(".tree-act").forEach(function(btn){
    btn.onclick=function(e){e.stopPropagation();var id=btn.dataset.folder;var act=btn.dataset.act;
      if(act==="delete"){if(confirm("Delete folder? Feeds become ungrouped."))api("/api/rss/folders/"+encodeURIComponent(id),"DELETE").then(refreshAll);return}
      if(act==="subfolder"){var n=prompt("Subfolder name");if(!n)return;api("/api/rss/folders","POST",{name:n,parentId:id}).then(refreshAll);return}
      if(act==="rename"){var name=prompt("New folder name");if(name)api("/api/rss/folders/"+encodeURIComponent(id),"PATCH",{name:name}).then(refreshAll);}
    };
  });
  el.querySelectorAll(".tree-item[data-scope]").forEach(function(b){
    b.onclick=function(){
      var sc=b.dataset.scope;
      if(sc==="all")rssState.scope={type:"all"};
      else rssState.scope={type:sc,id:b.dataset.id};
      renderTree();loadArticles();
    };
  });
  el.querySelectorAll(".tree-feed-move").forEach(function(sel){
    sel.onchange=function(){
      var feedId=sel.dataset.feed;
      var folderId=sel.value||null;
      api("/api/rss/feeds/"+encodeURIComponent(feedId),"PATCH",{folderId:folderId}).then(refreshAll);
    };
  });
}
function articleQuery(){
  var q=[];
  if(rssState.scope.type==="feed")q.push("feed="+encodeURIComponent(rssState.scope.id));
  if(rssState.scope.type==="folder")q.push("folder="+encodeURIComponent(rssState.scope.id));
  if(document.getElementById("rss-unread-only").checked)q.push("unread=1");
  var s=document.getElementById("rss-search").value.trim();
  if(s)q.push("q="+encodeURIComponent(s));
  q.push("limit=120");
  return q.length?"?"+q.join("&"):"";
}
function renderArticles(){
  var list=document.getElementById("rss-articles");
  var dense=rssState.view==="dense";
  var filtered=filterTags(rssState.items);
  var hint="";
  if(!filtered.length&&rssState.items.length)hint='<p class="dim" style="padding:1rem">No articles match your topic focus or mute filters. Clear focus chips or widen filters.</p>';
  list.innerHTML=hint+filtered.map(function(it){
    var cls="rss-row"+(dense?"":" card-view")+(!it.read?" unread":"");
    var thumb=it.thumbUrl?'<img class="thumb" src="'+esc(it.thumbUrl)+'" alt=""/>':'<span class="thumb"></span>';
    var dur=it.durationSec?'<span class="rss-yt-badge">'+Math.floor(it.durationSec/60)+":"+String(it.durationSec%60).padStart(2,"0")+'</span>':"";
    return '<article class="'+cls+'" data-id="'+esc(it.id)+'">'+thumb+
      '<div><div class="src">'+esc(it.feedTitle||it.feedId)+'</div><p class="rss-title">'+dur+esc(it.title)+'</p></div>'+
      '<span class="age">'+esc(relAge(it.firstSeenAt))+'</span>'+
      '<p class="snippet">'+esc((it.summary||"").slice(0,dense?160:280))+'</p></article>';
  }).join("")||'<p class="dim" style="padding:1rem">No articles in this view.</p>';
  list.querySelectorAll(".rss-row").forEach(function(row){
    row.onclick=function(){openArticle(row.dataset.id)};
  });
}
function setActionStatus(msg,isErr){var el=document.getElementById("rss-action-status");el.textContent=msg||"";el.className=isErr?"bad":"dim";}
function showAiSummary(text){
  var box=document.getElementById("rss-ai-summary");
  if(!text){box.style.display="none";return;}
  box.style.display="block";
  document.getElementById("rss-ai-summary-text").textContent=text;
}
function openArticle(id){
  rssState.selected=id;
  setActionStatus("");
  document.getElementById("rss-list-pane").classList.add("with-reader");
  var pane=document.getElementById("rss-read-pane");
  pane.classList.remove("hidden");
  api("/api/rss/entries/"+encodeURIComponent(id)).then(function(r){
    var it=r.item;
    document.getElementById("rss-read-title").innerHTML="<h2 style='margin:0;font-size:1rem'>"+esc(it.title)+"</h2><p class='dim' style='margin:.35rem 0 0;font-size:.75rem'>"+esc(it.feedTitle||"")+"</p>";
    document.getElementById("rss-read-body").innerHTML=it.contentHtml||("<p>"+esc(it.summary||"")+"</p>");
    document.getElementById("rss-open-ext").href=it.link||"#";
    document.getElementById("rss-star").textContent=it.starred?"Starred":"Star";
    var sumBtn=document.getElementById("rss-summarize");
    var recBtn=document.getElementById("rss-recallio");
    sumBtn.disabled=!r.llmEnabled;
    sumBtn.title=r.llmEnabled?"":"LLM not configured";
    recBtn.disabled=!r.recallioEnabled;
    recBtn.title=r.recallioEnabled?"":"Recallio not configured";
    showAiSummary(r.summary?r.summary.summary:"");
    if(!it.read)api("/api/rss/read","POST",{ids:[it.id]}).then(loadArticles);
  });
}
function loadTree(){return api("/api/rss/tree").then(function(r){rssState.tree=r.tree;renderTree()})}
function loadArticles(){
  var list=document.getElementById("rss-articles");
  list.innerHTML='<p class="dim" style="padding:1rem">Loading articles…</p>';
  return api("/api/news"+articleQuery()).then(function(r){
    rssState.tags=r.tags||[];rssState.prefs=r.prefs||{mutedTags:[],focusTags:[]};
    rssState.items=r.items||[];
    rssState.listMeta={total:r.total||rssState.items.length,filtered:rssState.items.length};
    renderChips();renderArticles();
  }).catch(function(e){list.innerHTML='<p class="bad" style="padding:1rem">'+esc(e.message||"Failed to load")+'</p>'});
}
function refreshAll(){return Promise.all([loadTree(),loadArticles()])}
document.getElementById("rss-view-toggle").onclick=function(){
  rssState.view=rssState.view==="dense"?"card":"dense";
  this.textContent=rssState.view==="dense"?"Dense list":"Card view";
  renderArticles();
};
document.getElementById("rss-close-read").onclick=function(){
  document.getElementById("rss-read-pane").classList.add("hidden");
  document.getElementById("rss-list-pane").classList.remove("with-reader");
};
document.getElementById("rss-mark-read").onclick=function(){
  var body={};
  if(rssState.scope.type==="feed")body.feedId=rssState.scope.id;
  if(rssState.scope.type==="folder")body.folderId=rssState.scope.id;
  api("/api/rss/read-all","POST",body).then(refreshAll);
};
document.getElementById("rss-unread-only").onchange=loadArticles;
document.getElementById("rss-search").onkeydown=function(e){if(e.key==="Enter")loadArticles()};
var nr=document.getElementById("news-refresh");
if(nr)nr.onclick=function(){nr.disabled=true;api("/api/rss/poll","POST",{}).then(refreshAll).finally(function(){nr.disabled=false})};
document.getElementById("rss-opml-export").onclick=function(){window.location.href="/api/rss/opml/export"};
document.getElementById("rss-opml-import").onclick=function(){document.getElementById("rss-opml-file").click()};
document.getElementById("rss-opml-file").onchange=function(ev){
  var f=ev.target.files[0];if(!f)return;
  f.text().then(function(xml){return api("/api/rss/opml/import","POST",{xml:xml,replace:false})}).then(refreshAll);
};
document.getElementById("rss-organize").onclick=function(){setOrganize(!rssState.organize);renderTree()};
document.getElementById("rss-add-folder").onclick=function(){
  var name=prompt("Folder name");if(!name)return;
  var parentId=rssState.scope.type==="folder"?rssState.scope.id:null;
  api("/api/rss/folders","POST",{name:name,parentId:parentId}).then(refreshAll).catch(function(e){alert(e.message)});
};
document.getElementById("rss-add-feed").onclick=function(){
  var url=prompt("Feed URL (RSS/Atom xmlUrl)");if(!url)return;
  var folderId=rssState.scope.type==="folder"?rssState.scope.id:undefined;
  api("/api/rss/feeds","POST",{xmlUrl:url,folderId:folderId}).then(refreshAll).catch(function(e){alert(e.message)});
};
document.getElementById("rss-star").onclick=function(){
  if(!rssState.selected)return;
  api("/api/rss/star","POST",{id:rssState.selected,starred:true}).then(function(){openArticle(rssState.selected)});
};
document.getElementById("rss-summarize").onclick=function(){
  if(!rssState.selected)return;
  var btn=document.getElementById("rss-summarize");btn.disabled=true;setActionStatus("Summarizing…");
  api("/api/rss/summarize","POST",{entryId:rssState.selected}).then(function(r){
    if(!r.ok)throw new Error(r.error||"failed");
    showAiSummary(r.text||"");setActionStatus(r.duplicate?"Already summarized":"Summary saved");
  }).catch(function(e){setActionStatus(e.message,true)}).finally(function(){btn.disabled=false;openArticle(rssState.selected)});
};
document.getElementById("rss-recallio").onclick=function(){
  if(!rssState.selected)return;
  var btn=document.getElementById("rss-recallio");btn.disabled=true;setActionStatus("Saving to Recallio…");
  api("/api/rss/recallio","POST",{entryId:rssState.selected}).then(function(r){
    if(!r.configured){setActionStatus("Recallio not configured",true);return;}
    if(!r.ok)throw new Error(r.error||"save failed");
    setActionStatus("Saved to Recallio");
  }).catch(function(e){setActionStatus(e.message,true)}).finally(function(){btn.disabled=false;openArticle(rssState.selected)});
};
var openId=sessionStorage.getItem("rss-open");
if(openId){sessionStorage.removeItem("rss-open");setTimeout(function(){openArticle(openId)},400);}
loadTree().then(loadArticles);
`;
}
