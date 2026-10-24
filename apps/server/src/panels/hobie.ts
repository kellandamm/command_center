import { panelCard } from "../ui/components";
import type { PanelModule } from "./types";

export const hobiePanel: PanelModule = {
  id: "hobie",
  title: "Hobie board",
  pageHref: "/agent?view=board",
  dashboardHtml: panelCard("panel-hobie", `
  <p class="dim ui-card-desc">Kanban columns linked to the Hobie queue.</p>
  <ul id="hobie-board-counts" class="todoist-list"></ul>`),
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

    if (path === "/api/hobie/board-summary" && req.method === "GET") {
      json(200, { counts: ctx.board.columnCounts() });
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
function renderHobieBoardCounts(counts){
  var el=document.getElementById("hobie-board-counts");
  if(!el)return;
  var cols=counts||{};
  var keys=Object.keys(cols);
  if(!keys.length){el.innerHTML='<li><div class="ui-empty" role="status"><p class="ui-empty-title">Board empty.</p></div></li>';return;}
  el.innerHTML=keys.map(function(k){
    return '<li class="todoist-item"><strong>'+esc(k)+'</strong> <span class="dim">'+esc(String(cols[k]))+'</span></li>';
  }).join("");
}
function loadHobie(){return api("/api/hobie/board-summary").then(function(r){renderHobieBoardCounts(r.counts)})}
loadHobie();
`;
}
