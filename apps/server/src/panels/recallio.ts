import { recallioConfigured, searchRecallio } from "../recallio/client";
import type { PanelModule } from "./types";

export const recallioPanel: PanelModule = {
  id: "recallio",
  title: "Recallio search",
  dashboardHtml: `
<section class="card" id="panel-recallio">
  <h2 style="margin:0 0 8px">Recallio search</h2>
  <p class="dim" id="recallio-status"></p>
  <form id="recallio-form" class="row" style="gap:8px;margin:10px 0">
    <input type="search" id="recallio-q" placeholder="Search memories…" autocomplete="off" style="flex:1" disabled>
    <button type="submit" id="recallio-submit" disabled>Search</button>
  </form>
  <div id="recallio-results"></div>
</section>`,
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (path === "/api/recallio/search" && req.method === "GET") {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const q = url.searchParams.get("q") ?? "";
      const outcome = await searchRecallio(ctx.cfg, q);
      json(200, {
        configured: outcome.configured,
        ok: outcome.ok,
        error: outcome.error,
        results: outcome.results,
        recallioEnabled: recallioConfigured(ctx.cfg),
      });
      return true;
    }
    return false;
  },
};

export function recallioDashboardScript(): string {
  return `
function renderRecallio(r){
  var st=document.getElementById("recallio-status");
  var form=document.getElementById("recallio-form");
  var input=document.getElementById("recallio-q");
  var btn=document.getElementById("recallio-submit");
  var box=document.getElementById("recallio-results");
  if(!r.recallioEnabled){
    st.textContent="Search disabled — set RECALLIO_URL on the server.";
    if(input)input.disabled=true;
    if(btn)btn.disabled=true;
    box.innerHTML="";
    return;
  }
  if(input)input.disabled=false;
  if(btn)btn.disabled=false;
  if(r.error){st.textContent=r.error;box.innerHTML="";return;}
  st.textContent=r.results&&r.results.length?r.results.length+" result(s)":"";
  var html="";
  (r.results||[]).forEach(function(hit){
    html+='<div class="feed-item" style="margin-top:8px">';
    var title=esc(hit.title||"Untitled");
    if(hit.url)html+='<strong><a href="'+esc(hit.url)+'" target="_blank" rel="noopener">'+title+'</a></strong>';
    else html+='<strong>'+title+'</strong>';
    if(hit.score!=null)html+=' <span class="dim">('+Number(hit.score).toFixed(2)+')</span>';
    if(hit.snippet&&hit.snippet!==hit.title)html+='<p class="dim" style="margin:.35em 0">'+esc(hit.snippet)+'</p>';
    html+='</div>';
  });
  box.innerHTML=html||'<p class="dim">No matches.</p>';
}
function runRecallioSearch(){
  var q=(document.getElementById("recallio-q")||{}).value||"";
  return api("/api/recallio/search?q="+encodeURIComponent(q)).then(renderRecallio);
}
var rf=document.getElementById("recallio-form");
if(rf)rf.onsubmit=function(e){e.preventDefault();runRecallioSearch()};
api("/api/recallio/search").then(renderRecallio);
`;
}
