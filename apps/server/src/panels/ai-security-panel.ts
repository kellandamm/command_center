import type { PanelModule } from "./types";

export const aiSecurityPanel: PanelModule = {
  id: "ai-security",
  title: "AI Security",
  dashboardHtml: `
<section class="card" id="panel-ai-security">
  <p class="dim" id="as-dash-meta">Loading…</p>
  <div id="as-dash-body" class="panel-scroll-region"></div>
  <p class="feeds-full-link dim"><a href="/ai-security">Open AI Security roundup</a></p>
</section>`,
};

export function aiSecurityDashboardScript(): string {
  return `
function renderAiSecurityDash(data){
  var meta=document.getElementById("as-dash-meta");
  var body=document.getElementById("as-dash-body");
  if(!body)return;
  var r=data.roundup;
  if(!r){
    if(meta)meta.textContent="No roundups published";
    body.innerHTML='<p class="dim">Publish via POST /api/ai-security/roundups.</p>';
    return;
  }
  if(meta)meta.textContent="Week of "+r.weekOf+" · "+(r.items||[]).length+" items";
  var html="";
  (r.items||[]).slice(0,5).forEach(function(it){
    html+='<div class="news-row"><strong>'+(it.sourceUrl?'<a href="'+esc(it.sourceUrl)+'" target="_blank" rel="noopener">'+esc(it.title)+'</a>':esc(it.title))+'</strong>';
    if(it.summary)html+='<p class="dim" style="margin:.25rem 0 0">'+esc(it.summary.slice(0,120))+(it.summary.length>120?"…":"")+'</p>';
    html+='</div>';
  });
  body.innerHTML=html||'<p class="dim">Roundup has no items.</p>';
}
function loadAiSecurityDash(){return api("/api/ai-security/roundups/latest").then(renderAiSecurityDash)}
loadAiSecurityDash();
`;
}
