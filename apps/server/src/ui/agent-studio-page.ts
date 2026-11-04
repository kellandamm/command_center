import type { NavLink } from "./layout";
import { workspacePage } from "./workspace";

const studioCss = `
.studio-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(17rem,.8fr);gap:1rem;align-items:start}
.studio-panel{min-width:0}
.studio-panel>p{margin:.35rem 0 1rem}
.studio-form textarea{min-height:8rem;resize:vertical}
.studio-form button{margin-top:.75rem}
.studio-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.65rem;margin-bottom:1rem}
.studio-stat{padding:.9rem 1rem;background:var(--card);border-radius:var(--radius);box-shadow:0 0 0 1px color-mix(in srgb,var(--foreground) 6%,transparent)}
.studio-stat strong{display:block;font-size:1.35rem;font-variant-numeric:tabular-nums}
.studio-stat span{font-size:.75rem;color:var(--muted-foreground)}
.studio-toolbar{display:flex;justify-content:space-between;align-items:center;gap:.75rem;margin:.75rem 0}
.studio-toolbar select{width:auto;min-width:10rem}
.studio-list{border-top:1px solid var(--border)}
.studio-task{padding:1rem .25rem;border-bottom:1px solid var(--border)}
.studio-task-head{display:flex;justify-content:space-between;align-items:start;gap:.75rem}
.studio-task h3{margin:0;font-size:.95rem;overflow-wrap:anywhere}
.studio-task p{margin:.35rem 0 0;overflow-wrap:anywhere}
.studio-task details{margin-top:.65rem}
.studio-task summary{cursor:pointer;color:var(--muted-foreground);font-size:.8125rem}
.studio-task pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:.8125rem}
.studio-pill{flex-shrink:0;border:1px solid var(--border);border-radius:999px;padding:.15rem .55rem;font-size:.7rem;font-weight:600}
.studio-pill[data-status="done"]{color:var(--ok)}
.studio-pill[data-status="failed"]{color:var(--destructive)}
.studio-pill[data-status="approval_needed"]{color:var(--warning)}
.studio-links{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem}
.studio-links a{font-size:.8125rem}
.studio-empty{padding:1.25rem 0;color:var(--muted-foreground)}
@media(max-width:850px){.studio-grid{grid-template-columns:1fr}}
@media(max-width:520px){.studio-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.studio-toolbar{align-items:stretch;flex-direction:column}.studio-toolbar select{width:100%}}
`;

export function agentStudioPage(nav?: NavLink[]): string {
  return workspacePage({
    title: "Agent Studio",
    description: "Break a goal into jobs for connected agents, follow results, and review actions that need your approval.",
    active: "/agent/studio",
    nav,
    extraCss: studioCss,
    body: `<div class="studio-stats" aria-label="Agent task counts">
  <div class="studio-stat"><strong id="studio-count-pending">—</strong><span>Waiting</span></div>
  <div class="studio-stat"><strong id="studio-count-leased">—</strong><span>In progress</span></div>
  <div class="studio-stat"><strong id="studio-count-done">—</strong><span>Completed</span></div>
  <div class="studio-stat"><strong id="studio-count-attention">—</strong><span>Needs attention</span></div>
</div>
<div class="studio-grid">
  <section class="card studio-panel" aria-labelledby="studio-tasks-heading">
    <h2 id="studio-tasks-heading">Team queue</h2>
    <p class="dim">Jobs are claimed by whichever connected worker is available. Results stay grouped by mission.</p>
    <div class="studio-toolbar">
      <label for="studio-filter">Show</label>
      <select id="studio-filter" aria-label="Filter agent tasks">
        <option value="all">All tasks</option><option value="pending">Waiting</option><option value="leased">In progress</option>
        <option value="done">Completed</option><option value="failed">Failed</option><option value="approval_needed">Needs approval</option>
      </select>
      <button id="studio-refresh" type="button" class="ghost">Refresh</button>
    </div>
    <div id="studio-tasks" class="studio-list" aria-live="polite"></div>
  </section>
  <div>
    <section class="card studio-panel" aria-labelledby="studio-dispatch-heading">
      <h2 id="studio-dispatch-heading">Dispatch a task</h2>
      <p class="dim">Split a goal into independent jobs. Put one job on each line; workers claim jobs from the shared queue.</p>
      <form id="studio-task-form" class="studio-form">
        <label for="studio-mission-title">Mission</label>
        <input id="studio-mission-title" required maxlength="200" placeholder="Prepare a launch recommendation"/>
        <label for="studio-task-text">Worker jobs <span class="dim">(up to 20)</span></label>
        <textarea id="studio-task-text" required maxlength="16000" placeholder="Research the main options and cite sources&#10;Compare costs and trade-offs&#10;Summarize risks and open questions"></textarea>
        <button id="studio-submit" type="submit">Dispatch mission</button>
      </form>
    </section>
    <section class="card studio-panel" style="margin-top:1rem" aria-labelledby="studio-approvals-heading">
      <h2 id="studio-approvals-heading">Pending approvals</h2>
      <p class="dim">Agent proposals stay paused until you decide.</p>
      <div id="studio-approvals" class="studio-list"></div>
    </section>
    <div class="studio-links">
      <a class="btn ghost" href="/agent?view=board">Open work board</a>
      <a class="btn ghost" href="/agent?view=queue">Open all queues</a>
    </div>
  </div>
</div>`,
    script: `
var studioTasks=[],studioApprovals=[];
function studioStatus(status){
  return ({pending:"Waiting",leased:"In progress",done:"Completed",failed:"Failed",approval_needed:"Needs approval"})[status]||status;
}
function studioDate(value){
  var date=new Date(value);
  return Number.isNaN(date.getTime())?"":date.toLocaleString();
}
function renderStudioTasks(){
  var box=$("studio-tasks"),filter=$("studio-filter").value;
  var tasks=studioTasks.filter(function(task){return filter==="all"||task.status===filter;});
  box.replaceChildren();
  if(!tasks.length){emptyState(box,"No tasks to show",filter==="all"?"Dispatch a task to get the team started.":"Try another status filter.");return;}
  tasks.slice().reverse().forEach(function(task){
    var row=element("article",undefined,"studio-task"),head=element("div",undefined,"studio-task-head");
    var title=task.text.split(/\\r?\\n/,1)[0].trim()||"Agent task";
    head.append(element("h3",title.length>140?title.slice(0,137)+"…":title));
    var badge=element("span",studioStatus(task.status),"studio-pill");badge.dataset.status=task.status;head.append(badge);
    row.append(head);
    if(task.missionTitle)row.append(element("p","Mission · "+task.missionTitle,"dim"));
    var meta=[studioDate(task.createdAt),task.result&&typeof task.result.tokens_used==="number"?task.result.tokens_used.toLocaleString()+" tokens":""].filter(Boolean).join(" · ");
    if(meta)row.append(element("p",meta,"dim"));
    var prompt=element("details"),promptSummary=element("summary","Task instructions");
    prompt.append(promptSummary,element("pre",task.text));row.append(prompt);
    if(task.result&&task.result.summary)row.append(element("p",task.result.summary));
    if(task.result&&task.result.evidence){
      var evidence=element("details"),summary=element("summary","Worker evidence");
      evidence.append(summary,element("pre",task.result.evidence));row.append(evidence);
    }
    box.append(row);
  });
}
function renderStudioStats(){
  var counts={pending:0,leased:0,done:0,attention:0};
  studioTasks.forEach(function(task){
    if(task.status==="approval_needed"||task.status==="failed")counts.attention++;
    else if(Object.hasOwn(counts,task.status))counts[task.status]++;
  });
  $("studio-count-pending").textContent=String(counts.pending);
  $("studio-count-leased").textContent=String(counts.leased);
  $("studio-count-done").textContent=String(counts.done);
  $("studio-count-attention").textContent=String(counts.attention);
}
function renderStudioApprovals(){
  var box=$("studio-approvals");box.replaceChildren();
  if(!studioApprovals.length){emptyState(box,"Nothing needs approval","Agent proposals will appear here.");return;}
  studioApprovals.forEach(function(approval){
    var row=element("article",undefined,"studio-task");
    row.append(element("h3",approval.action_id),element("p",approval.reason||"No reason provided."));
    row.append(element("p","Expires "+studioDate(approval.expires_at),"dim"));
    var actions=element("div",undefined,"row");
    [["Approve","/approve","primary"],["Deny","/deny","ghost"]].forEach(function(action){
      var button=element("button",action[0],action[2]);button.type="button";
      button.onclick=function(){busy(button,async function(){
        await api("/api/approvals/"+encodeURIComponent(approval.id)+action[1],"POST",{});
        if(await loadStudio())message(action[0]==="Approve"?"Approval recorded.":"Proposal denied.");
      });};
      actions.append(button);
    });
    row.append(actions);box.append(row);
  });
}
async function loadStudio(){
  $("studio-refresh").disabled=true;
  try{
    var overview=await api("/api/agent-queue/overview");
    studioTasks=overview.tasks||[];studioApprovals=overview.approvals||[];
    renderStudioStats();renderStudioTasks();renderStudioApprovals();
    $("studio-task-form").querySelectorAll("textarea,button").forEach(function(control){control.disabled=false;});
    return true;
  }catch(error){
    if(String(error&&error.message||error).includes("403")){
      errorState($("studio-tasks"),"Agent Studio task history requires an owner login.");
      errorState($("studio-approvals"),"Pending approvals require an owner login.");
      $("studio-task-form").querySelectorAll("textarea,button").forEach(function(control){control.disabled=true;});
      message("Sign in as the workspace owner to dispatch work or review agent results.",true);
    }else{
      errorState($("studio-tasks"),error.message||"Could not load agent tasks.");
      errorState($("studio-approvals"),error.message||"Could not load pending approvals.");
      message(error.message||"Could not load Agent Studio.",true);
    }
    return false;
  }finally{$("studio-refresh").disabled=false;}
}
$("studio-filter").onchange=renderStudioTasks;
$("studio-refresh").onclick=function(){busy(this,loadStudio);};
$("studio-task-form").onsubmit=function(event){
  event.preventDefault();
  var text=$("studio-task-text").value.trim();
  if(!text)return;
  busy($("studio-submit"),async function(){
    var title=$("studio-mission-title").value.trim();
    var tasks=text.split(/\\r?\\n/).map(function(task){return task.trim();}).filter(Boolean);
    if(!title)throw new Error("Enter a mission title.");
    if(!tasks.length)throw new Error("Add at least one worker job, one per line.");
    if(tasks.length>20)throw new Error("A mission can include up to 20 worker jobs.");
    var result=await api("/api/agent-queue/missions","POST",{title:title,tasks:tasks});
    $("studio-mission-title").value="";
    $("studio-task-text").value="";
    if(await loadStudio())message(result.tasks.length+" jobs dispatched for “"+title+"”.");
  });
};
loadStudio();
`,
  });
}
