import type { PanelModule } from "./types";

export const hobiePanel: PanelModule = {
  id: "hobie",
  title: "Hobie queue",
  dashboardHtml: `
<section class="card" id="panel-hobie">
  <h2 style="margin:0 0 8px">Hobie queue</h2>
  <p class="dim">Tasks from MCP agents. Urgent items first.</p>
  <ul id="hobie-list" class="todoist-list"></ul>
</section>`,
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };

    if (path === "/api/hobie/queue" && req.method === "GET") {
      json(200, { tasks: ctx.hobieQueue.list({ status: "pending" }) });
      return true;
    }

    return false;
  },
};

export function hobieDashboardScript(): string {
  return `
function renderHobie(rows){
  var el=document.getElementById("hobie-list");
  if(!el)return;
  if(!rows||!rows.length){el.innerHTML='<li class="dim">Queue empty.</li>';return;}
  el.innerHTML=rows.map(function(t){
    var tag=t.urgent?'<span class="bad">urgent</span> ':'';
    return '<li class="todoist-item">'+tag+'<strong>'+esc(t.title)+'</strong><div class="dim">'+esc(t.clientId)+' · '+esc(t.status)+'</div><div>'+esc(t.body)+'</div></li>';
  }).join("");
}
function loadHobie(){return api("/api/hobie/queue").then(function(r){renderHobie(r.tasks)})}
loadHobie();
`;
}
