import { page } from "./layout";

export function summariesPage(): string {
  return page({
    title: "Summaries — Command center",
    active: "/summaries",
    body: `<header class="page-header">
  <h1>Article summaries</h1>
  <p class="dim">AI summaries are kept even after feed entries are pruned. Search and open the original or live entry when it still exists.</p>
</header>
<div class="card" style="margin-bottom:1rem">
  <h2 style="margin:0 0 .75rem;font-size:.875rem">Auto-summarize settings</h2>
  <label class="row" style="margin:0 0 .5rem;font-weight:400"><input type="checkbox" id="sum-auto-star"/> Starred articles</label>
  <p class="dim" style="margin:0 0 .5rem;font-size:.8125rem">Folder auto-summarize (folder ids from feed tree):</p>
  <input type="text" id="sum-folder-ids" placeholder="comma-separated folder ids" style="margin-bottom:.5rem"/>
  <label style="margin:.5rem 0 .35rem">Max summaries per hour</label>
  <input type="number" id="sum-max-hour" min="0" max="60" step="1" style="max-width:6rem"/>
  <button type="button" class="ghost" id="sum-save-prefs" style="margin-top:.75rem">Save settings</button>
  <span class="dim" id="sum-prefs-status" style="margin-left:.5rem;font-size:.8125rem"></span>
</div>
<div class="card">
  <div class="row" style="justify-content:space-between;margin-bottom:.75rem">
    <input type="search" id="sum-search" placeholder="Search summaries" style="max-width:18rem"/>
    <span class="dim" id="sum-count"></span>
  </div>
  <div id="sum-list"></div>
</div>`,
    script: summariesPageScript(),
  });
}

function summariesPageScript(): string {
  return `
function loadPrefs(){
  return api("/api/news").then(function(r){
    var p=r.prefs||{};
    document.getElementById("sum-auto-star").checked=!!p.summarizeAutoStarred;
    document.getElementById("sum-folder-ids").value=(p.summarizeFolderIds||[]).join(", ");
    document.getElementById("sum-max-hour").value=p.summarizeMaxPerHour!=null?p.summarizeMaxPerHour:10;
  });
}
document.getElementById("sum-save-prefs").onclick=function(){
  var ids=document.getElementById("sum-folder-ids").value.split(",").map(function(s){return s.trim()}).filter(Boolean);
  api("/api/news/prefs","PUT",{
    summarizeAutoStarred:document.getElementById("sum-auto-star").checked,
    summarizeFolderIds:ids,
    summarizeMaxPerHour:Number(document.getElementById("sum-max-hour").value)
  }).then(function(r){
    document.getElementById("sum-prefs-status").textContent="Saved";
    setTimeout(function(){document.getElementById("sum-prefs-status").textContent=""},2000);
  }).catch(function(e){document.getElementById("sum-prefs-status").textContent=e.message});
};
function renderList(items){
  document.getElementById("sum-count").textContent=(items||[]).length+" summaries";
  document.getElementById("sum-list").innerHTML=(items||[]).map(function(s){
    var link=s.entryExists?'<a href="/news" onclick="sessionStorage.setItem(\\'rss-open\\',\\''+esc(s.entryId)+'\\')">Open in reader</a>'
      :(s.url?'<a href="'+esc(s.url)+'" target="_blank" rel="noopener">Original URL</a>':'<span class="dim">No link</span>');
    return '<article class="feed-item"><div class="row" style="justify-content:space-between;align-items:flex-start"><strong>'+esc(s.title)+'</strong><span class="dim" style="font-size:.75rem">'+esc(s.createdAt)+'</span></div>'
      +'<p class="dim" style="margin:.35em 0;font-size:.8125rem">'+esc((s.feedName||"")+(s.folderName?" · "+s.folderName:""))+' · '+esc(s.model)+'</p>'
      +'<p style="margin:.5em 0;font-size:.875rem">'+esc(s.summary)+'</p>'
      +'<p style="margin:0;font-size:.8125rem">'+link+'</p></article>';
  }).join("")||'<p class="dim">No summaries yet. Use Summarize on an article in News.</p>';
}
function loadSummaries(){
  var q=document.getElementById("sum-search").value.trim();
  var path="/api/summaries"+(q?"?q="+encodeURIComponent(q):"");
  return api(path).then(function(r){renderList(r.items)});
}
document.getElementById("sum-search").onkeydown=function(e){if(e.key==="Enter")loadSummaries()};
loadPrefs();loadSummaries();
`;
}
