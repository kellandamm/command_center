import type { PanelModule } from "./types";

export const taggedNewsPanel: PanelModule = {
  id: "tagged-news",
  title: "Tagged news",
  pageHref: "/news",
  dashboardHtml: `
<section class="card" id="panel-tagged-news">
  <p class="dim" id="tn-status">Loading…</p>
  <div id="tn-list" class="feeds-panel-scroll panel-scroll-region"></div>
  <p class="feeds-full-link dim"><a href="/news">Open full tagged news view</a></p>
</section>`,
};

export function taggedNewsDashboardScript(): string {
  return `
function renderTaggedNews(data){
  var st=document.getElementById("tn-status");
  var items=data.items||[];
  if(st)st.textContent=items.length?items.length+" stories":"No tagged stories yet";
  var html="";
  items.slice(0,8).forEach(function(it){
    html+='<div class="news-row"><strong>'+(it.link?'<a href="'+esc(it.link)+'" target="_blank" rel="noopener">'+esc(it.title)+'</a>':esc(it.title))+'</strong>';
    if(it.tags&&it.tags.length)html+=' <span class="dim">'+esc(it.tags.slice(0,2).join(", "))+'</span>';
    html+='</div>';
  });
  var el=document.getElementById("tn-list");
  if(el)el.innerHTML=html||'<p class="dim">Add feeds in Settings, then open tagged news to tune topics.</p>';
}
function loadTaggedNews(){return api("/api/news").then(renderTaggedNews)}
loadTaggedNews();
`;
}
