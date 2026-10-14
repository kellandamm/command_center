import type { PanelModule } from "./types";

export const activityPanel: PanelModule = {
  id: "activity",
  title: "Activity",
  pageHref: "/activity",
  dashboardHtml: `
<section class="card" id="panel-activity">
  <h2 style="margin:0 0 8px">Activity</h2>
  <p class="dim">Updates from external agents (MCP / webhooks).</p>
  <ul id="activity-list" class="todoist-list"></ul>
</section>`,
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (path === "/api/activity/updates" && req.method === "GET") {
      const url = new URL(req.url ?? "/", "http://local");
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 40)));
      json(200, { updates: ctx.panelUpdates.list(limit) });
      return true;
    }
    return false;
  },
};

export function activityDashboardScript(): string {
  return `
function renderActivity(rows){
  var el=document.getElementById("activity-list");
  if(!el)return;
  if(!rows||!rows.length){el.innerHTML='<li class="dim">No agent updates yet.</li>';return;}
  el.innerHTML=rows.map(function(u){
    var t=new Date(u.createdAt).toLocaleString();
    return '<li class="todoist-item"><div class="dim">'+esc(u.panel)+' · '+esc(u.clientId)+' · '+esc(t)+'</div><div>'+esc(u.markdown)+'</div></li>';
  }).join("");
}
function loadActivity(){return api("/api/activity/updates").then(function(r){renderActivity(r.updates)})}
loadActivity();
`;
}
