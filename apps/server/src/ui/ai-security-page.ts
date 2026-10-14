import { page } from "./layout";

export function aiSecurityPage(): string {
  return page({
    title: "AI Security — Command center",
    active: "/ai-security",
    body: `<header class="page-header">
  <h1>AI Security</h1>
  <p class="dim">Weekly roundup published by your external security agent — latest edition and archive.</p>
</header>
<div class="briefing-toolbar">
  <label class="dim" style="margin:0;display:flex;align-items:center;gap:.5rem;font-weight:500">
    <span>Week of</span>
    <select id="as-week" aria-label="Roundup week"><option value="">Latest</option></select>
  </label>
  <span class="dim" id="as-meta"></span>
</div>
<div id="as-empty" class="card" style="display:none">
  <h2>No roundups yet</h2>
  <p class="dim" style="margin:.5rem 0 0">Publish the first edition with <code>POST /api/ai-security/roundups</code> and your admin token.</p>
</div>
<div id="as-content" style="display:none">
  <section class="card" id="as-latest">
    <div class="section-head" style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.75rem">
      <h2 style="margin:0">This week</h2>
      <span class="status-pill ok" id="as-published"></span>
    </div>
    <div id="as-items"></div>
  </section>
  <section class="card" style="margin-top:1rem" id="as-archive-wrap">
    <h2>Archive</h2>
    <ul id="as-archive" style="margin:.5rem 0 0;padding-left:1.2rem"></ul>
  </section>
</div>`,
    script: aiSecurityScript(),
  });
}

function aiSecurityScript(): string {
  return `
var asWeeks=[];
function fmtDay(d){
  try{return new Date(d+"T12:00:00Z").toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"})}catch(e){return d}
}
function fmtWhen(iso){
  if(!iso)return "";
  try{return new Date(iso).toLocaleString()}catch(e){return iso}
}
function renderItems(items){
  return items.map(function(it){
    return '<div class="feed-item"><strong><a href="'+esc(it.sourceUrl)+'" target="_blank" rel="noopener">'+esc(it.title)+'</a></strong>'
      +'<p class="dim" style="margin:.25em 0 0">'+esc(it.summary)+'</p>'
      +'<p class="dim" style="margin:.2em 0 0;font-size:.8rem">'+esc(fmtDay(it.date))+'</p></div>';
  }).join("");
}
function showEmpty(){
  document.getElementById("as-empty").style.display="";
  document.getElementById("as-content").style.display="none";
  document.getElementById("as-meta").textContent="";
}
function showRoundup(r){
  document.getElementById("as-empty").style.display="none";
  document.getElementById("as-content").style.display="";
  document.getElementById("as-published").textContent="Published "+fmtWhen(r.publishedAt);
  document.getElementById("as-meta").textContent="Week of "+fmtDay(r.weekOf)+" · "+r.items.length+" items";
  document.getElementById("as-items").innerHTML=renderItems(r.items);
}
function fillArchive(weeks,active){
  var ul=document.getElementById("as-archive");
  if(weeks.length<=1){document.getElementById("as-archive-wrap").style.display="none";return}
  document.getElementById("as-archive-wrap").style.display="";
  ul.innerHTML=weeks.map(function(w){
    var on=w===active?' style="font-weight:600"':"";
    return '<li'+on+'><a href="#" data-week="'+esc(w)+'">Week of '+esc(fmtDay(w))+'</a></li>';
  }).join("");
  ul.querySelectorAll("a[data-week]").forEach(function(a){
    a.onclick=function(e){e.preventDefault();document.getElementById("as-week").value=a.getAttribute("data-week");loadWeek(a.getAttribute("data-week"))};
  });
}
function loadWeek(weekOf){
  var path=weekOf?"/api/ai-security/roundups/"+encodeURIComponent(weekOf):"/api/ai-security/roundups/latest";
  return api(path).then(function(j){
    var r=j.roundup;
    if(!r){showEmpty();return}
    showRoundup(r);
    fillArchive(asWeeks,r.weekOf);
  });
}
function init(){
  api("/api/ai-security/roundups").then(function(j){
    asWeeks=j.weeks||[];
    var sel=document.getElementById("as-week");
    sel.innerHTML='<option value="">Latest</option>'+asWeeks.map(function(w){
      return '<option value="'+esc(w)+'">'+esc(fmtDay(w))+'</option>';
    }).join("");
    sel.onchange=function(){loadWeek(sel.value||null)};
    if(!asWeeks.length){showEmpty();return}
    if(j.latest)showRoundup(j.latest);
    else loadWeek(null);
    fillArchive(asWeeks,j.latest?j.latest.weekOf:null);
  }).catch(function(err){
    showEmpty();
    document.querySelector("#as-empty p").textContent=err.message||"Failed to load.";
  });
}
init();
`;
}
