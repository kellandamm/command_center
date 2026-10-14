import { page } from "./layout";

export function newsPage(): string {
  return page({
    title: "Tagged news — Command center",
    active: "/news",
    body: `<header class="page-header">
  <h1>Tagged news</h1>
  <p class="dim">Feeds auto-tagged by keywords and source. Focus topics with chips; mute noise you do not want.</p>
</header>
<div class="news-toolbar row">
  <button type="button" class="ghost" id="news-refresh">Refresh feeds</button>
  <span class="dim" id="news-status"></span>
</div>
<div class="card" style="margin-bottom:1rem">
  <h2 style="margin:0 0 .75rem;font-size:.875rem">Topics</h2>
  <div class="tag-chip-bar" id="news-focus-chips" role="group" aria-label="Focus topics"></div>
  <p class="dim" style="margin:.75rem 0 0;font-size:.8125rem">Click a chip to focus. Click again to clear focus. Muted topics are hidden from the list.</p>
</div>
<div class="card news-list-card">
  <div class="row" style="justify-content:space-between;margin-bottom:.75rem">
    <h2 style="margin:0;font-size:.875rem">Stories</h2>
    <span class="dim" id="news-count"></span>
  </div>
  <div class="news-compact-list" id="news-list"></div>
  <div class="row" style="margin-top:.75rem">
    <button type="button" class="ghost" id="news-more" style="display:none">Show more</button>
  </div>
</div>
<div class="card" style="margin-top:1rem">
  <h2 style="margin:0 0 .5rem;font-size:.875rem">Muted topics</h2>
  <div id="news-muted" class="dim" style="font-size:.875rem">None</div>
</div>`,
    script: newsPageScript(),
  });
}

function newsPageScript(): string {
  return `
var newsState={tags:[],prefs:{mutedTags:[],focusTags:[]},items:[],shown:0,pageSize:25};
function tagLabel(id){var t=newsState.tags.find(function(x){return x.id===id});return t?t.label:id}
function savePrefs(patch){
  return api("/api/news/prefs","PUT",Object.assign({},newsState.prefs,patch)).then(function(r){
    newsState.prefs=r.prefs;renderChips();renderMuted();renderList(true);
  });
}
function toggleFocus(id){
  var focus=newsState.prefs.focusTags.slice();
  var i=focus.indexOf(id);
  if(i>=0)focus.splice(i,1);else focus.push(id);
  return savePrefs({focusTags:focus});
}
function toggleMute(id){
  var muted=newsState.prefs.mutedTags.slice();
  var i=muted.indexOf(id);
  if(i>=0)muted.splice(i,1);else muted.push(id);
  var focus=newsState.prefs.focusTags.filter(function(t){return muted.indexOf(t)<0});
  return savePrefs({mutedTags:muted,focusTags:focus});
}
function renderChips(){
  var bar=document.getElementById("news-focus-chips");
  var muted=new Set(newsState.prefs.mutedTags||[]);
  var focus=new Set(newsState.prefs.focusTags||[]);
  bar.innerHTML=newsState.tags.map(function(t){
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
function renderMuted(){
  var el=document.getElementById("news-muted");
  var muted=newsState.prefs.mutedTags||[];
  if(!muted.length){el.textContent="None";return}
  el.innerHTML=muted.map(function(id){
    return '<button type="button" class="tag-chip muted" data-id="'+esc(id)+'">'+esc(tagLabel(id))+' · unmute</button>';
  }).join(" ");
  el.querySelectorAll("button").forEach(function(b){
    b.onclick=function(){toggleMute(b.dataset.id)};
  });
}
function renderList(reset){
  if(reset)newsState.shown=0;
  var list=document.getElementById("news-list");
  var end=Math.min(newsState.shown+newsState.pageSize,newsState.items.length);
  if(reset){
    list.innerHTML="";
    newsState.shown=0;
    end=Math.min(newsState.pageSize,newsState.items.length);
  }
  var chunk=newsState.items.slice(newsState.shown,end);
  newsState.shown=end;
  chunk.forEach(function(it){
    var row=document.createElement("article");
    row.className="news-row"+(it.read?" dim":"");
    var tags=(it.tags||[]).map(function(t){return '<span class="tag-mini">'+esc(tagLabel(t))+'</span>'}).join("");
    row.innerHTML='<div class="row" style="justify-content:space-between;align-items:flex-start;gap:.5rem">'
      +'<strong style="flex:1">'+(it.link?'<a href="'+esc(it.link)+'" target="_blank" rel="noopener">'+esc(it.title)+'</a>':esc(it.title))+'</strong>'
      +(it.read?"":'<button type="button" class="ghost mark-read" data-id="'+esc(it.id)+'">Mark read</button>')
      +'</div>'
      +(it.summary?'<p class="dim" style="margin:.35em 0;font-size:.8125rem">'+esc(it.summary.slice(0,220))+'</p>':'')
      +'<div class="row" style="gap:.35rem;flex-wrap:wrap">'+tags+'</div>'
      +'<p class="dim" style="margin:.35em 0 0;font-size:.75rem">'+esc(it.feedId)+' · '+esc(it.firstSeenAt)+'</p>';
    list.appendChild(row);
  });
  document.getElementById("news-count").textContent=newsState.items.length+" shown";
  var more=document.getElementById("news-more");
  more.style.display=newsState.shown<newsState.items.length?"inline-flex":"none";
  list.querySelectorAll(".mark-read").forEach(function(b){
    b.onclick=function(){api("/api/feeds/read","POST",{ids:[b.dataset.id]}).then(loadNews)};
  });
}
function loadNews(){
  return api("/api/news").then(function(r){
    newsState.tags=r.tags||[];
    newsState.prefs=r.prefs||{mutedTags:[],focusTags:[]};
    newsState.items=r.items||[];
    document.getElementById("news-status").textContent=(r.total||0)+" items in cache";
    renderChips();renderMuted();renderList(true);
  });
}
document.getElementById("news-more").onclick=function(){renderList(false)};
var nr=document.getElementById("news-refresh");
if(nr)nr.onclick=function(){nr.disabled=true;api("/api/feeds/fetch","POST",{}).then(loadNews).finally(function(){nr.disabled=false})};
loadNews();
`;
}
