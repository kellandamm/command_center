import type { NavLink } from "./layout";
import { workspacePage } from "./workspace";

const overviewCss = `
.agent-overview-hero{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:1rem}
.agent-overview-hero p{margin:.25rem 0 0;color:var(--muted-foreground)}
.agent-overview-actions{display:flex;gap:.5rem;flex-wrap:wrap}
.agent-overview-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin-bottom:1rem}
.agent-overview-stat{display:block;min-width:0;padding:1rem;text-decoration:none;color:var(--foreground)}
.agent-overview-stat:hover{border-color:var(--primary)}
.agent-overview-stat strong{display:block;font-size:1.55rem;font-variant-numeric:tabular-nums}
.agent-overview-stat span{font-size:.8rem;color:var(--muted-foreground)}
.agent-overview-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(17rem,.8fr);gap:1rem;align-items:start}
.agent-overview-column{display:grid;gap:1rem;min-width:0}
.agent-overview-section{min-width:0}
.agent-overview-section h2{margin-top:0}
.agent-overview-list{border-top:1px solid var(--border)}
.agent-overview-item{display:flex;justify-content:space-between;align-items:start;gap:.75rem;padding:.85rem .25rem;border-bottom:1px solid var(--border);min-width:0}
.agent-overview-item-main{min-width:0;overflow-wrap:anywhere}
.agent-overview-item-main h3{margin:0;font-size:.92rem}
.agent-overview-item-main p{margin:.25rem 0 0;color:var(--muted-foreground);font-size:.8rem;overflow-wrap:anywhere}
.agent-overview-badge{flex-shrink:0;border:1px solid var(--border);border-radius:999px;padding:.15rem .55rem;font-size:.7rem;font-weight:600}
.agent-overview-badge[data-status="done"]{color:var(--ok)}
.agent-overview-badge[data-status="failed"]{color:var(--destructive)}
.agent-overview-badge[data-status="approval_needed"]{color:var(--warning)}
.agent-overview-approval-actions{display:flex;gap:.4rem;margin-top:.5rem}
.agent-overview-approval-actions button{font-size:.78rem;padding:.35rem .6rem}
.agent-overview-agent{display:flex;align-items:center;gap:.75rem}
.agent-overview-agent-mark{display:grid;place-items:center;flex:0 0 2.25rem;height:2.25rem;border-radius:var(--radius);background:var(--muted);color:var(--primary)}
.agent-overview-agent-mark svg{width:1.1rem;height:1.1rem}
.agent-overview-agent .agent-overview-item-main{flex:1}
.agent-overview-agent .agent-overview-item-main p{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.agent-overview-link{font-size:.8rem;white-space:nowrap}
@media(max-width:850px){.agent-overview-grid{grid-template-columns:1fr}}
@media(max-width:600px){.agent-overview-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.agent-overview-hero{align-items:flex-start;flex-direction:column}}
`;

export function agentOverviewPage(nav?: NavLink[]): string {
  return workspacePage({
    title: "Agent Overview",
    description: "See what your agents are doing, review work, and jump into the next task.",
    active: "/agent/overview",
    nav,
    extraCss: overviewCss,
    body: `<section class="agent-overview-hero" aria-label="Agent workspace actions">
  <div><h2 id="agent-overview-greeting">Your agent workspace</h2><p>One place to track tasks, approvals, and connected agents.</p></div>
  <div class="agent-overview-actions"><a class="btn ghost" href="/agent?view=chat">Chat with an agent</a><a class="btn primary" href="/agent?view=studio">Start a mission</a></div>
</section>
<section class="agent-overview-stats" aria-label="Agent task summary">
  <a class="card agent-overview-stat" href="/agent?view=queue"><strong id="agent-overview-waiting">—</strong><span>Waiting</span></a>
  <a class="card agent-overview-stat" href="/agent?view=queue"><strong id="agent-overview-running">—</strong><span>Running now</span></a>
  <a class="card agent-overview-stat" href="/agent?view=studio"><strong id="agent-overview-approvals">—</strong><span>Needs approval</span></a>
  <a class="card agent-overview-stat" href="/agent?view=studio"><strong id="agent-overview-completed">—</strong><span>Completed</span></a>
</section>
<div class="agent-overview-grid">
  <div class="agent-overview-column">
    <section class="card agent-overview-section">
      <div class="row" style="justify-content:space-between"><h2>Needs your approval</h2><a class="agent-overview-link" href="/agent?view=studio">See all</a></div>
      <div id="agent-overview-approval-list" class="agent-overview-list" aria-live="polite"></div>
    </section>
    <section class="card agent-overview-section">
      <div class="row" style="justify-content:space-between"><h2>Running now</h2><a class="agent-overview-link" href="/agent?view=queue">View queue</a></div>
      <div id="agent-overview-running-list" class="agent-overview-list" aria-live="polite"></div>
    </section>
    <section class="card agent-overview-section">
      <div class="row" style="justify-content:space-between"><h2>Recent activity</h2><a class="agent-overview-link" href="/agent?view=studio">View all work</a></div>
      <div id="agent-overview-recent-list" class="agent-overview-list" aria-live="polite"></div>
    </section>
  </div>
  <div class="agent-overview-column">
    <section class="card agent-overview-section">
      <div class="row" style="justify-content:space-between"><h2>Your agents</h2><a class="agent-overview-link" href="/agent?view=chat">Manage in Chat</a></div>
      <div id="agent-overview-agents" class="agent-overview-list" aria-live="polite"></div>
    </section>
    <section class="card agent-overview-section">
      <h2>Agent tools</h2>
      <div class="agent-overview-list">
        <a class="agent-overview-item" href="/agent?view=board"><span class="agent-overview-item-main"><h3>Work board</h3><p>Plan and organize agent work.</p></span><span aria-hidden="true">→</span></a>
        <a class="agent-overview-item" href="/agent?view=usage"><span class="agent-overview-item-main"><h3>Usage</h3><p>Review agent usage and check-ins.</p></span><span aria-hidden="true">→</span></a>
      </div>
    </section>
  </div>
</div>`,
    actions: '<button id="agent-overview-refresh" type="button" class="ghost">Refresh</button>',
    script: `
var agentOverviewTasks=[],agentOverviewApprovals=[];
function overviewDate(value){
  var date=new Date(value);return Number.isNaN(date.getTime())?"":date.toLocaleString();
}
function overviewStatus(status){
  return ({pending:"Waiting",leased:"Running",done:"Completed",failed:"Failed",approval_needed:"Needs approval"})[status]||status;
}
function overviewCount(id,value){$(id).textContent=String(value);}
function renderOverviewStats(){
  var counts={pending:0,leased:0,done:0,approvals:0};
  agentOverviewTasks.forEach(function(task){
    if(Object.hasOwn(counts,task.status))counts[task.status]++;
  });
  overviewCount("agent-overview-waiting",counts.pending);
  overviewCount("agent-overview-running",counts.leased);
  overviewCount("agent-overview-completed",counts.done);
  overviewCount("agent-overview-approvals",agentOverviewApprovals.length);
}
function overviewTaskItem(task){
  var row=element("article",undefined,"agent-overview-item"),main=element("div",undefined,"agent-overview-item-main");
  var title=(task.text||"Agent task").split(/\\r?\\n/,1)[0].trim();
  main.append(element("h3",title.length>120?title.slice(0,117)+"…":title));
  var detail=[task.missionTitle,task.result&&task.result.summary,overviewDate(task.result&&task.result.recordedAt||task.createdAt)].filter(Boolean).join(" · ");
  if(detail)main.append(element("p",detail));
  var badge=element("span",overviewStatus(task.status),"agent-overview-badge");badge.dataset.status=task.status;
  row.append(main,badge);return row;
}
function renderOverviewTasks(){
  var running=$("agent-overview-running-list"),active=agentOverviewTasks.filter(function(task){return task.status==="leased";}).slice().reverse();
  running.replaceChildren();
  if(!active.length)emptyState(running,"Nothing running right now","New work will appear here when an agent claims it.");
  else active.slice(0,5).forEach(function(task){running.append(overviewTaskItem(task));});

  var recent=$("agent-overview-recent-list");
  var finished=agentOverviewTasks.filter(function(task){return task.result;}).slice().sort(function(a,b){
    return String((b.result&&b.result.recordedAt)||b.createdAt).localeCompare(String((a.result&&a.result.recordedAt)||a.createdAt));
  });
  recent.replaceChildren();
  if(!finished.length)emptyState(recent,"No recent results","Completed agent work will show up here.");
  else finished.slice(0,5).forEach(function(task){recent.append(overviewTaskItem(task));});
}
function renderOverviewApprovals(){
  var box=$("agent-overview-approval-list");box.replaceChildren();
  if(!agentOverviewApprovals.length){emptyState(box,"All caught up","Agent proposals that need a decision will appear here.");return;}
  agentOverviewApprovals.slice(0,5).forEach(function(approval){
    var row=element("article",undefined,"agent-overview-item"),main=element("div",undefined,"agent-overview-item-main");
    main.append(element("h3",approval.action_id),element("p",approval.reason||"No reason provided."));
    main.append(element("p","Expires "+overviewDate(approval.expires_at)));
    var actions=element("div",undefined,"agent-overview-approval-actions");
    [["Approve","/approve","primary"],["Deny","/deny","ghost"]].forEach(function(action){
      var button=element("button",action[0],action[2]);button.type="button";
      button.onclick=function(){busy(button,async function(){
        await api("/api/approvals/"+encodeURIComponent(approval.id)+action[1],"POST",{});
        await loadAgentOverview();message(action[0]==="Approve"?"Approval recorded.":"Proposal denied.");
      });};
      actions.append(button);
    });
    main.append(actions);row.append(main);box.append(row);
  });
}
function renderOverviewAgents(agents){
  var box=$("agent-overview-agents");box.replaceChildren();
  if(!agents.length){emptyState(box,"No connected agents","Connect an OpenAI-compatible agent to start chatting.");return;}
  agents.slice(0,8).forEach(function(agent){
    var row=element("article",undefined,"agent-overview-item agent-overview-agent"),mark=element("span",undefined,"agent-overview-agent-mark");
    mark.setAttribute("aria-hidden","true");mark.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="7" width="16" height="13" rx="2"/><path d="M12 7V3h-3M2 13h2m16 0h2m-11-2v2m4-2v2"/></svg>';
    var main=element("div",undefined,"agent-overview-item-main");
    main.append(element("h3",agent.name),element("p",agent.model+" · "+(agent.credentialConfigured?"Credential configured":"Credential missing")));
    var link=appLink("Chat","/agent?view=chat","agent-overview-link");
    row.append(mark,main,link);box.append(row);
  });
  if(agents.length>8){
    box.append(appLink("View all "+agents.length+" agents","/agent?view=chat","agent-overview-item agent-overview-link"));
  }
}
async function loadAgentOverview(){
  var button=$("agent-overview-refresh");button.disabled=true;
  try{
    var results=await Promise.allSettled([api("/api/agent-queue/overview"),api("/api/agents")]);
    var queue=results[0];
    if(queue.status==="fulfilled"){
      agentOverviewTasks=queue.value.tasks||[];agentOverviewApprovals=queue.value.approvals||[];
      renderOverviewStats();renderOverviewTasks();renderOverviewApprovals();
    }else{
      ["agent-overview-waiting","agent-overview-running","agent-overview-approvals","agent-overview-completed"].forEach(function(id){overviewCount(id,"—");});
      var queueMessage=String(queue.reason&&queue.reason.message||queue.reason||"");
      var ownerRequired=queueMessage.includes("403")||queueMessage.includes("owner login");
      var taskError=ownerRequired?"Sign in as the workspace owner to see task history and approvals.":queueMessage||"Could not load agent tasks.";
      if(ownerRequired){
        emptyState($("agent-overview-approval-list"),"Owner view","Sign in as the workspace owner to review agent proposals.");
        emptyState($("agent-overview-running-list"),"Owner view","Sign in as the workspace owner to see live task status.");
        emptyState($("agent-overview-recent-list"),"Owner view","Sign in as the workspace owner to see task history.");
      }else{
        errorState($("agent-overview-approval-list"),taskError);
        errorState($("agent-overview-running-list"),taskError);
        errorState($("agent-overview-recent-list"),taskError);
      }
    }
    var connected=results[1];
    if(connected.status==="fulfilled")renderOverviewAgents(connected.value.agents||[]);
    else errorState($("agent-overview-agents"),connected.reason&&connected.reason.message||"Could not load connected agents.");
    if(queue.status==="rejected"&&connected.status==="rejected")throw queue.reason;
    return true;
  }finally{button.disabled=false;}
}
$("agent-overview-refresh").onclick=function(){busy(this,loadAgentOverview);};
loadingState($("agent-overview-approval-list"),"Loading approvals…");
loadingState($("agent-overview-running-list"),"Loading active tasks…");
loadingState($("agent-overview-recent-list"),"Loading recent work…");
loadingState($("agent-overview-agents"),"Loading connected agents…");
loadAgentOverview().catch(function(error){message(error.message||"Could not load Agent Overview.",true);});
`,
  });
}
