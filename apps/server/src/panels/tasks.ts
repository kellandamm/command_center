import { BOARD_COLUMNS } from "../board/types";
import { dayKey } from "../store";
import { sortDashboardTasks, type TaskFilter } from "../tasks/sort";
import { earliestBlockStartByCard } from "../tasks/blocks";
import { panelCard } from "../ui/components";
import type { PanelModule } from "./types";

export const tasksPanel: PanelModule = {
  id: "tasks",
  title: "Tasks",
  pageHref: "/agent?view=board",
  dashboardHtml: panelCard("panel-tasks", `
  <div class="tasks-chips" id="tasks-chips" role="toolbar" aria-label="Task filters"></div>
  <ul id="tasks-list" class="todoist-list panel-scroll-region"></ul>`),
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (path !== "/api/dashboard/tasks" || req.method !== "GET") return false;
    const url = new URL(req.url ?? "/", "http://local");
    const filter = (url.searchParams.get("filter") ?? "all") as TaskFilter;
    const today = dayKey(new Date(), ctx.cfg.tz);
    const blocks = ctx.calendar?.planning().blocks ?? [];
    const blockMap = earliestBlockStartByCard(blocks);
    const blockStart = (id: string) => blockMap.get(id) ?? null;
    const cards = sortDashboardTasks(ctx.board.list(), blockStart, filter, today);
    json(200, {
      filter,
      today,
      columns: BOARD_COLUMNS.filter((c) => c !== "Done"),
      tasks: cards.map((c) => ({
        id: c.id,
        title: c.title,
        column: c.column,
        dueDate: c.dueDate,
        priority: c.priority,
        blockStart: blockStart(c.id),
      })),
    });
    return true;
  },
};

export function tasksDashboardScript(): string {
  return `
var tasksFilter="all";
function renderTaskChips(columns){
  var el=document.getElementById("tasks-chips");
  if(!el)return;
  var chips=[{id:"all",label:"All"},{id:"due-soon",label:"Due soon"},{id:"high",label:"High priority"}];
  (columns||[]).forEach(function(col){chips.push({id:"column:"+col,label:col});});
  el.innerHTML=chips.map(function(c){
    var on=c.id===tasksFilter?" aria-pressed=\\"true\\"":"";
    return '<button type="button" class="ghost tasks-chip" data-filter="'+esc(c.id)+'"'+on+'>'+esc(c.label)+'</button>';
  }).join("");
  el.querySelectorAll(".tasks-chip").forEach(function(btn){
    btn.onclick=function(){tasksFilter=btn.dataset.filter||"all";loadTasks();};
  });
}
function renderTasks(data){
  renderTaskChips(data.columns);
  var list=document.getElementById("tasks-list");
  if(!list)return;
  var rows=data.tasks||[];
  if(!rows.length){list.innerHTML='<li><div class="ui-empty" role="status"><p class="ui-empty-title">No tasks match this filter.</p></div></li>';return;}
  list.innerHTML=rows.map(function(t){
    var meta=[t.column,t.priority];
    if(t.dueDate)meta.push("due "+t.dueDate);
    if(t.blockStart)meta.push(new Date(t.blockStart).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}));
    return '<li class="todoist-item"><a href="/agent?view=board"><strong>'+esc(t.title)+'</strong></a><div class="dim">'+esc(meta.join(" · "))+'</div></li>';
  }).join("");
}
function loadTasks(){return api("/api/dashboard/tasks?filter="+encodeURIComponent(tasksFilter)).then(renderTasks);}
loadTasks();
`;
}
