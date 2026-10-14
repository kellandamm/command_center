import type { PanelModule } from "./types";

export const hobiePanel: PanelModule = {
  id: "hobie",
  title: "Hobie queue",
  pageHref: "/hobie",
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
      const url = new URL(req.url ?? "/", "http://local");
      const status = url.searchParams.get("status") as "pending" | "claimed" | "done" | undefined;
      json(200, { tasks: status ? ctx.hobieQueue.list({ status }) : ctx.hobieQueue.list() });
      return true;
    }

    const doneMatch = path.match(/^\/api\/hobie\/queue\/([^/]+)\/done$/);
    if (doneMatch && req.method === "POST") {
      const ok = await ctx.hobieQueue.markDone(decodeURIComponent(doneMatch[1]!));
      json(200, { ok });
      return true;
    }

    const delMatch = path.match(/^\/api\/hobie\/queue\/([^/]+)$/);
    if (delMatch && req.method === "DELETE") {
      const ok = await ctx.hobieQueue.remove(decodeURIComponent(delMatch[1]!));
      json(200, { removed: ok });
      return true;
    }

    if (path === "/api/hobie/queue/clear" && req.method === "POST") {
      let body = "";
      for await (const c of req) body += c;
      const parsed = JSON.parse(body || "{}") as { onlyDone?: boolean };
      const n = await ctx.hobieQueue.clear(parsed.onlyDone ? { status: "done" } : {});
      json(200, { cleared: n });
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
