import type { PanelModule } from "./types";

export const dailyBriefingPanel: PanelModule = {
  id: "daily-briefing",
  title: "Daily briefing",
  pageHref: "/briefing",
  dashboardHtml: `
<section class="card" id="panel-daily-briefing">
  <p class="dim" id="pdb-meta">Loading…</p>
  <div id="pdb-body" class="panel-scroll-region"></div>
  <p class="dim"><a href="/briefing">Open full daily briefing</a></p>
</section>`,
};

export function dailyBriefingDashboardScript(): string {
  return `
function pdbStatus(sources){
  var keys=["todoist","weather","calendar","github","board"];
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
