import type { NavLink } from "./layout";
import { page } from "./layout";

const winsCss = `
.wins-form{display:flex;flex-wrap:wrap;gap:.5rem;align-items:flex-end;margin-bottom:1rem}
.wins-week{margin-bottom:1.25rem}
.wins-week h2{font-size:1rem;margin:0 0 .35rem}
.wins-week summary{font-size:.875rem}
.wins-list{list-style:none;margin:.5rem 0 0;padding:0}
.wins-list li{padding:.35rem 0;border-bottom:1px solid var(--border)}
`;

export function winsPage(nav?: NavLink[]): string {
  return page({
    title: "Wins — Command center",
    active: "/wins",
    nav,
    extraCss: winsCss,
    body: `<header class="page-header"><h1>Wins</h1><p class="dim">Completed work from the board, merged PRs, and manual entries.</p></header>
<form class="card wins-form" id="wins-add-form">
  <label>Win <input type="text" id="wins-title" required maxlength="300" placeholder="What shipped?"/></label>
  <button type="submit">Add win</button>
</form>
<div id="wins-weeks"></div>`,
    script: winsScript(),
  });
}

function winsScript(): string {
  return `
function renderWins(data){
  var root=document.getElementById("wins-weeks");
  var weeks=data.weeks||[];
  if(!weeks.length){root.innerHTML='<p class="dim card">No wins yet.</p>';return;}
  root.innerHTML=weeks.map(function(w){
    var items=(w.wins||[]).map(function(win){
      return '<li><strong>'+esc(win.title)+'</strong> <span class="dim">'+esc(win.source)+' · '+esc(new Date(win.at).toLocaleString())+'</span></li>';
    }).join("");
    var summary=w.summary?'<p class="dim">'+esc(w.summary)+'</p>':'';
    return '<section class="card wins-week"><h2>'+esc(w.isoWeek)+'</h2>'+summary+'<ul class="wins-list">'+items+'</ul></section>';
  }).join("");
}
function loadWins(){
  return api("/api/wins").then(renderWins);
}
document.getElementById("wins-add-form").onsubmit=function(ev){
  ev.preventDefault();
  var title=document.getElementById("wins-title").value.trim();
  if(!title)return;
  api("/api/wins","POST",{title:title}).then(function(){document.getElementById("wins-title").value="";loadWins()});
};
loadWins();
`;
}
