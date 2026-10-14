import type { IncomingMessage, ServerResponse } from "node:http";
import { todoistConfigured } from "../config";
import { createTask, completeTask, listTasks, partitionTodayAndOverdue } from "../todoist/client";
import type { PanelModule } from "./types";

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const c of req) body += c;
  if (!body) return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const todoistPanel: PanelModule = {
  id: "todoist",
  title: "Todoist",
  dashboardHtml: `
<section class="card" id="panel-todoist">
  <h2 style="margin:0 0 .5em">Todoist</h2>
  <p class="dim" id="todoist-status">Loading…</p>
  <form id="todoist-add" class="row" style="margin:.5em 0">
    <input type="text" id="todoist-input" placeholder="Quick add task…" autocomplete="off" style="flex:1;min-width:0">
    <button type="submit">Add</button>
  </form>
  <div id="todoist-overdue-wrap" hidden>
    <h3 class="dim" style="font-size:.95rem;margin:.8em 0 .3em">Overdue</h3>
    <ul id="todoist-overdue" class="todoist-list"></ul>
  </div>
  <div id="todoist-today-wrap" hidden>
    <h3 class="dim" style="font-size:.95rem;margin:.8em 0 .3em">Today</h3>
    <ul id="todoist-today" class="todoist-list"></ul>
  </div>
</section>`,
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    const cfg = ctx.cfg;
    const configured = todoistConfigured(cfg);

    if (path === "/api/todoist" && req.method === "GET") {
      if (!configured) {
        json(200, { configured: false, overdue: [], today: [] });
        return true;
      }
      try {
        const tasks = await listTasks(cfg.todoistApiToken!);
        const { overdue, today } = partitionTodayAndOverdue(tasks, new Date(), cfg.tz);
        json(200, { configured: true, overdue, today });
      } catch (err) {
        json(200, { configured: true, error: err instanceof Error ? err.message : "Todoist request failed", overdue: [], today: [] });
      }
      return true;
    }
    if (path === "/api/todoist/tasks" && req.method === "POST") {
      if (!configured) {
        json(400, { error: "Todoist is not configured — set TODOIST_API_TOKEN on the server." });
        return true;
      }
      const body = await readJsonBody(req);
      const content = typeof body.content === "string" ? body.content : "";
      try {
        const task = await createTask(cfg.todoistApiToken!, content);
        json(200, { task });
      } catch (err) {
        json(400, { error: err instanceof Error ? err.message : "could not create task" });
      }
      return true;
    }
    if (path === "/api/todoist/complete" && req.method === "POST") {
      if (!configured) {
        json(400, { error: "Todoist is not configured — set TODOIST_API_TOKEN on the server." });
        return true;
      }
      const body = await readJsonBody(req);
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) {
        json(400, { error: "task id is required" });
        return true;
      }
      try {
        await completeTask(cfg.todoistApiToken!, id);
        json(200, { ok: true });
      } catch (err) {
        json(400, { error: err instanceof Error ? err.message : "could not complete task" });
      }
      return true;
    }
    return false;
  },
};

export function todoistDashboardScript(): string {
  return `
function renderTodoist(r){
  var st=document.getElementById("todoist-status");
  var form=document.getElementById("todoist-add");
  var input=document.getElementById("todoist-input");
  if(!r.configured){
    st.textContent="Todoist disabled — set TODOIST_API_TOKEN on the server.";
    if(form)form.style.display="none";
    document.getElementById("todoist-overdue-wrap").hidden=true;
    document.getElementById("todoist-today-wrap").hidden=true;
    return;
  }
  if(form)form.style.display="";
  if(r.error){st.textContent="Error: "+r.error;st.className="bad";}
  else{
    var n=(r.overdue||[]).length+(r.today||[]).length;
    st.textContent=n?n+" task"+(n===1?"":"s")+" due today or overdue":"All caught up for today";
    st.className="dim";
  }
  function row(t){
    var due=t.due&&t.due.string?" <span class=\\"dim\\">("+esc(t.due.string)+")</span>":"";
    return '<li class="todoist-item"><label class="row" style="align-items:flex-start;gap:10px;margin:0;font-weight:400"><input type="checkbox" class="todoist-done" data-id="'+esc(t.id)+'"><span>'+esc(t.content)+due+'</span></label></li>';
  }
  var od=r.overdue||[];var td=r.today||[];
  document.getElementById("todoist-overdue-wrap").hidden=!od.length;
  document.getElementById("todoist-today-wrap").hidden=!td.length;
  document.getElementById("todoist-overdue").innerHTML=od.map(row).join("");
  document.getElementById("todoist-today").innerHTML=td.map(row).join("");
  document.querySelectorAll(".todoist-done").forEach(function(cb){cb.onchange=function(){
    if(!cb.checked)return;
    api("/api/todoist/complete","POST",{id:cb.dataset.id}).then(loadTodoist).catch(function(e){cb.checked=false;alert(e.message)});
  }});
}
function loadTodoist(){return api("/api/todoist").then(renderTodoist)}
var tf=document.getElementById("todoist-add");
if(tf)tf.onsubmit=function(e){e.preventDefault();var input=document.getElementById("todoist-input");var v=input.value.trim();if(!v)return;
 api("/api/todoist/tasks","POST",{content:v}).then(function(){input.value="";return loadTodoist()}).catch(function(err){alert(err.message)})};
loadTodoist();
`;
}
