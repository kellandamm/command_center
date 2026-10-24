import { loadingState, panelCard } from "../ui/components";
import type { PanelModule } from "./types";

export const dailyBriefingPanel: PanelModule = {
  id: "daily-briefing",
  title: "Daily briefing",
  pageHref: "/briefing",
  dashboardHtml: panelCard("panel-daily-briefing", `
  <div id="pdb-meta-wrap">${loadingState()}</div>
  <div id="pdb-body" class="panel-scroll-region"></div>
  <p class="dim"><a href="/briefing">Open full daily briefing</a></p>`),
};

export function dailyBriefingDashboardScript(): string {
  return `
function pdbStatus(sources){
  var keys=["weather","calendar","topics"];
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
  var metaWrap=document.getElementById("pdb-meta-wrap");
  var body=document.getElementById("pdb-body");
  if(!body)return;
  if(!data.briefing){
    if(metaWrap)metaWrap.innerHTML='<p class="dim" id="pdb-meta">No briefing for today yet</p>';
    body.innerHTML='<div class="ui-empty" role="status"><p class="ui-empty-title">Run refresh on the daily briefing page or wait for the schedule.</p></div>';
    return;
  }
  var b=data.briefing;
  if(metaWrap)metaWrap.innerHTML='<p class="dim" id="pdb-meta">'+esc(b.day)+" · "+esc(pdbStatus(b.sources))+'</p>';
  var parts=[];
  var topics=b.sources&&b.sources.topics;
  if(topics&&topics.data){
    topics.data.items.forEach(function(t){parts.push("<p><strong>"+esc(t.keyword)+"</strong> — "+esc(t.summary||t.message||t.status)+"</p>")});
  }
  body.innerHTML=parts.join("")||'<div class="ui-empty" role="status"><p class="ui-empty-title">Briefing snapshot is empty.</p></div>';
}
function loadDailyBriefingPanel(){return api("/api/daily-briefing").then(renderDailyBriefing)}
loadDailyBriefingPanel();
`;
}
