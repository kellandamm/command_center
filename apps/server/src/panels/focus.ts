import type { IncomingMessage } from "node:http";
import { todoistConfigured } from "../config";
import { listTasks, partitionTodayAndOverdue, type TodoistTask } from "../todoist/client";
import { ValidationError } from "../settings";
import { OWNER_ACTION_FORBIDDEN } from "../owner-auth";
import { validateFocusSessionInput } from "../focus/store";
import { panelCard } from "../ui/components";
import type { PanelModule } from "./types";

function ownerDenied(res: import("node:http").ServerResponse): void {
  res.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: OWNER_ACTION_FORBIDDEN }));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const c of req) body += c;
  try {
    return JSON.parse(body || "{}") as Record<string, unknown>;
  } catch {
    throw new ValidationError("invalid JSON");
  }
}

function focusTasksForPicker(tasks: TodoistTask[], now: Date, tz: string): Array<{ id: string; content: string; dueLabel: string | null }> {
  const { overdue, today } = partitionTodayAndOverdue(tasks, now, tz);
  const picked = [...overdue, ...today];
  const seen = new Set(picked.map((t) => t.id));
  // shortcut: pad the picker with undated tasks when today/overdue lists are short.
  for (const task of tasks) {
    if (picked.length >= 40) break;
    if (!seen.has(task.id)) {
      picked.push(task);
      seen.add(task.id);
    }
  }
  return picked.slice(0, 40).map((task) => ({
    id: task.id,
    content: task.content,
    dueLabel: task.due?.string ?? null,
  }));
}

export const focusPanel: PanelModule = {
  id: "focus",
  title: "Focus",
  dashboardHtml: panelCard("panel-focus", `
  <p class="dim" id="focus-status">Pick a native Board task and start a focus session. Focus never completes tasks.</p>
  <div class="row focus-controls">
    <label class="dim">Work (min)
      <input id="focus-work-min" type="number" min="1" max="180" value="25" />
    </label>
    <label class="dim">Break (min)
      <input id="focus-break-min" type="number" min="1" max="60" value="5" />
    </label>
  </div>
  <select id="focus-task-select" class="panel-scroll-region focus-task-select" aria-label="Focus task"></select>
  <div class="row focus-actions">
    <button type="button" id="focus-start">Start focus</button>
    <button type="button" id="focus-stop" class="ghost" hidden>End session</button>
  </div>
  <p id="focus-timer" class="focus-timer" aria-live="polite"></p>`),
  async handle(ctx, req, res, path) {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (path === "/api/dashboard/focus/tasks" && req.method === "GET") {
      const native = ctx.board.list().filter((card) => card.column !== "Done")
        .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.title.localeCompare(b.title))
        .map((card) => ({ id: card.id, content: card.title, source: "board", dueLabel: card.dueDate }));
      if (!todoistConfigured(ctx.cfg)) {
        json(200, { configured: true, tasks: native, timezone: ctx.cfg.tz });
        return true;
      }
      try {
        const tasks = await listTasks(ctx.cfg.todoistApiToken!);
        json(200, {
          configured: true,
          tasks: [...native, ...focusTasksForPicker(tasks, new Date(), ctx.cfg.tz).map((task) => ({ ...task, source: "todoist" }))],
          timezone: ctx.cfg.tz,
        });
      } catch (err) {
        json(200, { configured: true, tasks: native, timezone: ctx.cfg.tz, externalError: "External Todoist tasks unavailable." });
      }
      return true;
    }
    if (path === "/api/dashboard/focus" && req.method === "GET") {
      json(200, { sessions: ctx.focusSessions.list(20).map((session) => ({ ...session, taskSource: session.taskSource ?? "todoist" })), owner: ctx.owner, timezone: ctx.cfg.tz });
      return true;
    }
    if (path === "/api/focus/sessions" && req.method === "POST") {
      if (!ctx.owner) return ownerDenied(res), true;
      const body = await readJsonBody(req);
      const input = validateFocusSessionInput(body);
      if (input.taskSource === "board" && !ctx.board.get(input.taskId)) throw new ValidationError("Native Board task no longer exists");
      const session = await ctx.focusSessions.append(input);
      json(201, { session });
      return true;
    }
    return false;
  },
};

export function focusDashboardScript(): string {
  return `
var focusStorageKey="cc.focus.state",focusSettingsKey="cc.focus.settings",focusTimerId=null;
function readFocusSettings(){
  try{var raw=localStorage.getItem(focusSettingsKey);if(!raw)return{workMin:25,breakMin:5};
    var s=JSON.parse(raw);return{workMin:Math.min(180,Math.max(1,Number(s.workMin)||25)),breakMin:Math.min(60,Math.max(1,Number(s.breakMin)||5))};}catch(_){return{workMin:25,breakMin:5};}
}
function writeFocusSettings(s){localStorage.setItem(focusSettingsKey,JSON.stringify(s));}
function readFocusState(){try{var raw=localStorage.getItem(focusStorageKey);return raw?JSON.parse(raw):null;}catch(_){return null;}}
function writeFocusState(st){if(st)localStorage.setItem(focusStorageKey,JSON.stringify(st));else localStorage.removeItem(focusStorageKey);}
function focusEls(){return{status:document.getElementById("focus-status"),select:document.getElementById("focus-task-select"),start:document.getElementById("focus-start"),stop:document.getElementById("focus-stop"),timer:document.getElementById("focus-timer"),work:document.getElementById("focus-work-min"),break:document.getElementById("focus-break-min")};}
function formatFocusRemaining(ms){var t=Math.max(0,Math.ceil(ms/1000)),m=Math.floor(t/60),s=t%60;return String(m)+":"+String(s).padStart(2,"0");}
function renderFocusTasks(data){
  var el=focusEls(),sel=el.select;if(!sel)return;
  sel.replaceChildren();
  el.start.disabled=false;
  if(!data.tasks.length){el.status.textContent="No tasks available. Add a native task on Board.";el.start.disabled=true;return;}
  el.status.textContent="Pick a task. Focus logs time only; it never completes tasks."+(data.externalError?" "+data.externalError:"");
  data.tasks.forEach(function(task){
    var opt=document.createElement("option");opt.value=task.source+":"+task.id;opt.dataset.taskId=task.id;opt.dataset.source=task.source;opt.dataset.title=task.content;opt.textContent=(task.source==="board"?"Native Board":"External Todoist")+" · "+task.content+(task.dueLabel?" · "+task.dueLabel:"");sel.appendChild(opt);
  });
}
function stopFocusTimer(){if(focusTimerId){clearInterval(focusTimerId);focusTimerId=null;}}
function completeFocusWork(state){
  var endedAt=new Date().toISOString();
  var durationMs=Date.parse(endedAt)-Date.parse(state.startedAt);
  return api("/api/focus/sessions","POST",{startedAt:state.startedAt,endedAt:endedAt,durationMs:durationMs,taskId:state.taskId,taskSource:state.taskSource||"todoist",taskTitle:state.taskTitle||undefined}).catch(function(err){focusEls().status.textContent="Focus time could not be saved: "+err.message;});
}
function tickFocus(){
  var el=focusEls(),state=readFocusState();if(!state||!el.timer)return;
  var remaining=state.endsAt-Date.now();
  if(remaining>0){el.timer.textContent=(state.phase==="work"?"Focus":"Break")+": "+formatFocusRemaining(remaining)+" · "+esc(state.taskTitle||"Task");return;}
  if(state.phase==="work"){
    completeFocusWork(state).then(function(){loadHeatmap&&loadHeatmap();});
    var settings=readFocusSettings();
    state={phase:"break",startedAt:new Date().toISOString(),endsAt:Date.now()+settings.breakMin*60000,taskId:state.taskId,taskTitle:state.taskTitle,taskSource:state.taskSource};
    writeFocusState(state);
    tickFocus();return;
  }
  writeFocusState(null);el.stop.hidden=true;el.start.hidden=false;el.timer.textContent="Break finished. Ready for another focus block?";stopFocusTimer();
}
function startFocusSession(){
  var el=focusEls(),sel=el.select;if(!sel||!sel.value)return;
  var settings={workMin:Math.min(180,Math.max(1,Number(el.work.value)||25)),breakMin:Math.min(60,Math.max(1,Number(el.break.value)||5))};
  writeFocusSettings(settings);el.work.value=String(settings.workMin);el.break.value=String(settings.breakMin);
  var opt=sel.selectedOptions[0];
  var state={phase:"work",startedAt:new Date().toISOString(),endsAt:Date.now()+settings.workMin*60000,taskId:opt.dataset.taskId,taskSource:opt.dataset.source,taskTitle:opt.dataset.title};
  writeFocusState(state);el.start.hidden=true;el.stop.hidden=false;stopFocusTimer();focusTimerId=setInterval(tickFocus,1000);tickFocus();
}
function endFocusEarly(){
  var state=readFocusState();if(state&&state.phase==="work")completeFocusWork(state).then(function(){loadHeatmap&&loadHeatmap();});
  writeFocusState(null);stopFocusTimer();var el=focusEls();el.stop.hidden=true;el.start.hidden=false;el.timer.textContent="";
}
function initFocusPanel(){
  var el=focusEls(),settings=readFocusSettings();
  if(el.work)el.work.value=String(settings.workMin);
  if(el.break)el.break.value=String(settings.breakMin);
  if(el.start)el.start.onclick=startFocusSession;
  if(el.stop)el.stop.onclick=endFocusEarly;
  return api("/api/dashboard/focus/tasks").then(renderFocusTasks).then(function(){
    var state=readFocusState();
    if(state){el.start.hidden=true;el.stop.hidden=false;stopFocusTimer();focusTimerId=setInterval(tickFocus,1000);tickFocus();}
  });
}
initFocusPanel();
`;
}
