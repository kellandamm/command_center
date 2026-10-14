import type { PanelModule } from "./types";

export const dailyBriefingPanel: PanelModule = {
  id: "daily-briefing",
  title: "Daily briefing",
  pageHref: "/briefing",
  dashboardHtml: `
<section class="card" id="panel-daily-briefing">
  <p class="dim" id="pdb-meta">Loading…</p>
  <div id="pdb-body" class="panel-scroll-region"></div>
  <p class="feeds-full-link dim"><a href="/briefing">Open full daily briefing</a></p>
</section>`,
};

export function dailyBriefingDashboardScript(): string {
  return `
function pdbStatus(sources){
  var keys=["news","ai","todoist","weather","calendar","github"];
  var ok=0,err=0;
  keys.forEach(function(k){
    var b=sources&&sources[k];
    if(!b)return;
    if(b.status==="ok")ok++;
    else if(b.status==="error")err++;
  });
  return ok+" sources ok"+(err?(" · "+err+" errors"):"");
}
function renderDailyBriefing(data){
  var meta=document.getElementById("pdb-meta");
  var body=document.getElementById("pdb-body");
  if(!body)return;
  if(!data.briefing){
    if(meta)meta.textContent="No briefing for today yet";
    body.innerHTML='<p class="dim">Run refresh on the daily briefing page or wait for the schedule.</p>';
    return;
  }
  var b=data.briefing;
  if(meta)meta.textContent=b.day+" · "+pdbStatus(b.sources);
  var parts=[];
  var news=b.sources&&b.sources.news;
  if(news&&news.status==="ok"&&news.data)parts.push("<p><strong>News</strong> — "+news.data.itemCount+" items</p>");
  var ai=b.sources&&b.sources.ai;
  if(ai&&ai.status==="ok"&&ai.data&&ai.data.content){
    var snip=ai.data.content.slice(0,220);
    if(ai.data.content.length>220)snip+="…";
    parts.push("<p><strong>AI</strong> — "+esc(snip)+"</p>");
  }
  var todo=b.sources&&b.sources.todoist;
  if(todo&&todo.status==="ok"&&todo.data){
    var n=(todo.data.overdue||[]).length+(todo.data.today||[]).length;
    parts.push("<p><strong>Todoist</strong> — "+n+" tasks due</p>");
  }
  body.innerHTML=parts.join("")||'<p class="dim">Briefing snapshot is empty.</p>';
}
function loadDailyBriefingPanel(){return api("/api/daily-briefing").then(renderDailyBriefing)}
loadDailyBriefingPanel();
`;
}
